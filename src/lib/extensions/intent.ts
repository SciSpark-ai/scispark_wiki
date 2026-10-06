import { createHash } from "node:crypto"
import { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { readRun } from "../workflows/store"
import { withVaultExclusive } from "../vault/exclusive"
import { canonicalJSON } from "./store"
import { exactRef } from "./dependencies"
import { listToolLibrary } from "./library"
import { ToolIntentInputSchema, ToolIntentResolutionSchema, type ToolIntentInput, type ToolIntentResolution } from "./contracts"
import { classifyToolIntent } from "./classification-attempt"
import { saveToolChoice } from "./choice-store"
import { ToolInputBindingError } from "./import-contract"
import { validateInputSchema } from "./inspect"
import { getToolManifest } from "./registry"
import { readImportedTool } from "./store"
import type { ToolManifest, ToolRef } from "./contracts"
import type { LibraryTool } from "./ui-contract"

export function intentOperationId(sessionId: string, operationId: string): string {
  const h = createHash("sha256").update(JSON.stringify([sessionId, operationId])).digest("hex")
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`
}
/** Only affirmative human wording grants save authority. Package descriptions never enter here. */
export function deriveWriteIntent(question: string): "outputs_only" | "update_wiki" {
  // Ambiguous, quoted, conditional and negative wording never grants authority.
  // The separate save action remains available when this conservative check declines.
  if (/\b(?:not|never|without|unless|if|would|could|might|should|suppose|imagine|whether|hypothetical|don['’]?t)\b|["“”`]|'[^']*\b(?:save|write|add|update)\b[^']*'/i.test(question)) return "outputs_only"
  return /(?:^|[.;!\n]|\b(?:and|then|also)\s+)(?:\s*please\s+)?\s*(?:save|write|add|update)\b[^.!?\n]{0,70}\b(?:wiki|knowledge base)\b/i.test(question)
    ? "update_wiki" : "outputs_only"
}
export const candidateSummary = (tool: LibraryTool) => ({ tool: tool.ref, name: tool.name, source: tool.ref.packageId, distinction: tool.description.replace(/\s+/g, " ").slice(0, 1000) })
const RecordSchema = z.object({ profileId: z.string(), vaultId: z.string(), input: ToolIntentInputSchema, resolution: ToolIntentResolutionSchema }).strict()
export async function resolveToolIntent(ctx: WorkflowContext, raw: ToolIntentInput): Promise<ToolIntentResolution> {
  const input = ToolIntentInputSchema.parse(raw), id = intentOperationId(input.sessionId, input.operationId)
  return withVaultExclusive(ctx.storage, `tool-intent-${id}`, async () => {
    const path = `.scispark/tools/intents/${id}.json`, saved = await ctx.storage.read(path)
    if (saved) {
      const previous = RecordSchema.parse(JSON.parse(saved))
      if (previous.profileId !== ctx.profileId || previous.vaultId !== ctx.vaultId || canonicalJSON(previous.input) !== canonicalJSON(input)) throw new Error("Intent operation conflict")
      return previous.resolution
    }
    const resolution = await resolve(ctx, input)
    await ctx.storage.write(path, JSON.stringify(RecordSchema.parse({ profileId: ctx.profileId, vaultId: ctx.vaultId, input, resolution })))
    return resolution
  })
}
async function resolve(ctx: WorkflowContext, input: ToolIntentInput): Promise<ToolIntentResolution> {
  if (input.existingRunId) {
    const run = await readRun(ctx, input.existingRunId)
    if (!run || run.sessionId !== input.sessionId) throw new Error("Run is outside this conversation")
    return { kind: "run", tool: run.tool, existingRunId: run.id }
  }
  const known = (await listToolLibrary(ctx)).tools
  const enabled = known.filter(t => t.enabled)
  const ready = enabled.filter(t => t.readiness.status === "ready")
  if (input.explicitTool) {
    const selected = ready.find(t => exactRef(t.ref) === exactRef(input.explicitTool!))
    return selected ? { kind: "run", tool: selected.ref } : { kind: "add-tool", message: "This tool is unavailable. Open Tools to enable its current version or finish setup." }
  }
  // Mentioning a tool is not asking to execute it. Name selection requires an
  // affirmative invocation, and names are data matched literally, never regexes.
  const invoked = /^(?:please\s+)?(?:use|run|start|invoke)\s+(.+)/i.exec(input.question)?.[1]?.toLocaleLowerCase()
  const named = invoked ? known.filter(t => invoked.startsWith(t.name.toLocaleLowerCase()) && /^(?:\s|[,:.!?]|$)/.test(invoked.slice(t.name.length))) : []
  if (named.some(tool => !tool.enabled || tool.readiness.status !== "ready")) {
    return named.length > 1
      ? { kind: "clarify", question: "Several enabled tools share that name. Select the intended tool in Tools; some need setup." }
      : { kind: "add-tool", message: `${named[0].name} is unavailable. Open Tools to enable it or choose Manage to finish setup.` }
  }
  if (named.length) return select(ctx, input, named)
  if (/^(?:please\s+)?(?:explain|summarize|describe|what (?:does|is)|how (?:does|did)|why)\b/i.test(input.question) && !/\b(?:run|start|conduct|perform|find|search)\b/i.test(input.question)) return { kind: "chat" }
  if (!ready.length) {
    const optionalAction = /^(?:(?:please|can you|could you)\s+)*(?:(?:find|search for)\s+(?:papers|studies|articles|literature)|(?:conduct|perform|start|run)\s+(?:(?:a|the)\s+)?(?:literature review|review|search|tool)|review\s+(?:the\s+)?literature)\b/i.test(input.question.trim())
    return optionalAction ? { kind: "add-tool", message: "Add a tool from Tools for this research task." } : { kind: "chat" }
  }
  const decision = await classifyToolIntent(ctx, input, ready)
  if (decision.kind === "chat") return { kind: "chat" }
  if (decision.kind === "clarify") return { kind: "clarify", question: "Would you like to discuss this, find papers, or run a research tool?" }
  if (new Set(decision.toolIds).size !== decision.toolIds.length || decision.toolIds.some(id => !ready[id])) throw new Error("Classifier selected an unavailable tool")
  if (!decision.toolIds.length) return { kind: "add-tool", message: "No enabled tool matches this task. Open Tools to add one." }
  return select(ctx, input, decision.toolIds.map(id => ready[id]))
}
async function select(ctx: WorkflowContext, input: ToolIntentInput, tools: LibraryTool[]): Promise<ToolIntentResolution> {
  if (tools.length === 1) return { kind: "run", tool: tools[0].ref }
  const choice = { id: intentOperationId(input.sessionId, input.operationId), prompt: "Choose a tool for this request", candidates: tools.map(candidateSummary) }
  await saveToolChoice(ctx, choice, input)
  return { kind: "choose", choice }
}

/** Bind only declared human request arguments. Session/source authority stays
 * in the host envelope. Unknown custom contracts require explicit adapter review. */
export function toolRunInput(input: ToolIntentInput, tool: ToolRef, manifest?: ToolManifest): Record<string, unknown> {
  const common = { question: input.question, sessionId: input.sessionId, ...(input.sources ? { sources: input.sources } : {}) }
  if (tool.packageId !== "scispark.builtin" && manifest?.kind === "native") return common
  if (tool.packageId !== "scispark.builtin") {
    if (!manifest || exactRef(manifest.ref) !== exactRef(tool)) throw new ToolInputBindingError()
    const properties = manifest.inputSchema.properties as Record<string, unknown> | undefined
    const openCite = tool.packageId === "neuromechanist.opencite" && tool.skillId === "SKILL.md" && manifest.entrypoint === "scispark-opencite-v1.py"
    if (!openCite && (!properties || !Object.hasOwn(properties, "question"))) throw new ToolInputBindingError()
    const args = openCite ? { query: input.question, limit: 10, fullText: false } : { question: input.question }
    if (!validateInputSchema(manifest.inputSchema).safeParse(args).success) throw new ToolInputBindingError()
    return args
  }
  if (tool.skillId === "find-papers") return { ...common, mode: "search", readSourcesOnly: false, transport: "chat", operationId: intentOperationId(input.sessionId, input.operationId) }
  if (tool.skillId === "idea-spark") return { direction: input.question, mode: "quick" }
  if (tool.skillId === "trending") return { mode: "auto" }
  return common
}

export async function bindToolRunInput(ctx: WorkflowContext, input: ToolIntentInput, tool: ToolRef) {
  return toolRunInput(input, tool, getToolManifest(tool) ?? (await readImportedTool(ctx, tool)).manifest)
}
