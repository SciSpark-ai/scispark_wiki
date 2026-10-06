import { createHash } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import { join } from "node:path"
import { z } from "zod"
import { ToolRefSchema, UuidSchema, type ToolRef } from "../extensions/contracts"
import { ImportToolSchema, ParallelHostActionSchema } from "../extensions/import-contract"
import { ImportedSnapshotSchema, extensionObjectPath, snapshotDigest } from "../extensions/store"
import { getToolManifest } from "../extensions/registry"
import { exactRef } from "../extensions/dependencies"
import { validateInputSchema } from "../extensions/inspect"
import { createCommandContext, runIsolatedCommand } from "../extensions/sandbox"
import { resolveCapturedToolEnvironment } from "../extensions/setup"
import { readConnectionRevision } from "../extensions/connections"
import { createConnectionBroker } from "../extensions/network-broker"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import type { WorkflowContext } from "./context"
import type { WorkflowIO } from "./adapters"
import { WikiProposalInputSchema } from "./contracts"
import { readArtifact } from "./artifacts"
import { readRun } from "./store"
import { canonicalJson, workflowHash } from "./journal"
import { withVaultExclusive } from "../vault/exclusive"
import { buildResearchView } from "./research-view"

const page = { offset: z.number().int().nonnegative(), length: z.number().int().min(1).max(16000) }
export const HostDecisionSchema = z.discriminatedUnion("type", [
  ParallelHostActionSchema,
  z.object({ type: z.literal("read_artifact"), artifactId: UuidSchema, ...page }).strict(),
  z.object({ type: z.literal("read_resource"), resourceId: z.string().min(1).max(1000), ...page }).strict(),
  z.object({ type: z.literal("read_research"), resourceId: z.string().min(1).max(1000), ...page }).strict(),
  z.object({ type: z.literal("run_command"), commandId: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal("invoke_skill"), tool: ToolRefSchema.optional(), slotId: z.string().min(1).max(1000).optional(), input: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ type: z.literal("publish_artifact"), kind: z.enum(["markdown", "papers", "bibtex", "file"]), title: z.string().min(1).max(500), mediaType: z.string().max(127), sourceRefs: z.array(z.string().max(2048)).max(1000), text: z.string().max(64000) }).strict(),
  z.object({ type: z.literal("propose_wiki_change"), proposal: WikiProposalInputSchema }).strict(),
  z.object({ type: z.literal("finish"), synthesize: z.boolean(), summary: z.string().max(32000), artifactIds: z.array(UuidSchema).max(100) }).strict(),
])
export type HostDecision = z.infer<typeof HostDecisionSchema>
export type HostAction = HostDecision & { id: string }
const FrameSchema = z.object({ id: UuidSchema, tool: ToolRefSchema, input: z.record(z.string(), z.unknown()), turn: z.number().int().nonnegative(),
  decision: HostDecisionSchema.optional(), prompt: z.string().max(64000).optional(), observations: z.array(z.string()), publicText: z.string(),
}).strict()
const HelperChoiceSchema = z.object({ id: UuidSchema, parentFrameId: UuidSchema, slotId: z.string(), candidates: z.array(ToolRefSchema).min(1), selected: ToolRefSchema.optional(), batchId: UuidSchema.optional(), branchId: UuidSchema.optional() }).strict()
export const HostContinuationSchema = z.object({ schemaVersion: z.literal(1), runId: UuidSchema, completed: z.boolean(), frames: z.array(FrameSchema).max(32),
  choices: z.array(HelperChoiceSchema).max(1000).default([]),
  waitingChoice: HelperChoiceSchema.optional(),
  parallel: z.object({ actionId: UuidSchema, parentFrameId: UuidSchema, branches: z.array(z.object({
    id: UuidSchema, frames: z.array(FrameSchema).max(32), completed: z.boolean(), summary: z.string(), waitingChoice: HelperChoiceSchema.optional(),
  }).strict()).length(2) }).strict().optional(),
}).strict()
export type HostContinuation = z.infer<typeof HostContinuationSchema>
export type HostFrame = HostContinuation["frames"][number]
export type HostActionResult = { status: "parallel"; branches: z.infer<typeof ParallelHostActionSchema>["branches"] } | { status: "ok"; value: unknown } | { status: "invoke"; tool: ToolRef; input: Record<string, unknown> } | { status: "needs-choice"; choice: NonNullable<HostContinuation["waitingChoice"]> } | { status: "finish"; summary: string; synthesize: boolean }
const path = (id: string) => `.scispark/tool-runs/${UuidSchema.parse(id)}/host-continuation.json`
export async function readHostContinuation(ctx: WorkflowContext, id: string): Promise<HostContinuation | null> {
  const run = await readRun(ctx, id)
  if (!run) throw new Error("Workflow run not found")
  const raw = await ctx.storage.read(path(id))
  if (!raw) return null
  const state = HostContinuationSchema.parse(JSON.parse(raw))
  if (state.runId !== id || [...state.frames, ...(state.parallel?.branches.flatMap(b => b.frames) ?? [])].some(f => ![run.tool, ...run.dependencies].some(t => exactRef(t) === exactRef(f.tool)))) throw new Error("Host continuation owner mismatch")
  if (state.parallel) {
    const parent = state.frames.at(-1), batch = state.parallel
    if (!parent || parent.id !== batch.parentFrameId || hostStepId(parent, "action") !== batch.actionId || parent.decision?.type !== "parallel") throw new Error("Parallel parent identity mismatch")
    for (const [index, branch] of batch.branches.entries()) {
      const planned = parent.decision.branches[index]
      if (branch.id !== hostStepId(parent, `parallel-${index}`) || branch.completed !== !branch.frames.length || (branch.frames.length && (branch.frames[0].id !== branch.id || exactRef(branch.frames[0].tool) !== exactRef(planned.tool) || canonicalJson(branch.frames[0].input) !== canonicalJson(planned.input)))) throw new Error("Parallel branch identity mismatch")
    }
  }
  return state
}
export async function writeHostContinuation(ctx: WorkflowContext, state: HostContinuation): Promise<void> {
  await ctx.storage.write(path(state.runId), JSON.stringify(HostContinuationSchema.parse(state)))
}
export function hostStepId(frame: HostFrame, suffix: string): string {
  const h = workflowHash(`${frame.id}:${frame.turn}:${suffix}`)
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`
}
const execution = new AsyncLocalStorage<{ ctx: WorkflowContext; id: string; io: WorkflowIO; branchId?: string }>()
/** Only the coordinator adapter binds IO. Browser/model input cannot create a
 * command scope, lease, new root run, settings override or alternate provider. */
export function withHostExecution<T>(ctx: WorkflowContext, id: string, io: WorkflowIO, work: () => Promise<T>): Promise<T> {
  const parent = execution.getStore()
  if (parent) throw new Error("Nested host execution is not allowed")
  return execution.run({ ctx, id, io }, work)
}
/** Short atomic merge; never hold this lock across provider/command work. */
export async function updateHostContinuation(ctx: WorkflowContext, id: string, update: (state: HostContinuation) => void) {
  return withVaultExclusive(ctx.storage, `host-continuation-${UuidSchema.parse(id)}`, async () => {
    const state = await readHostContinuation(ctx, id)
    if (!state) throw new Error("Missing host continuation")
    update(state)
    if (state.parallel) state.waitingChoice = state.parallel.branches.find(b => b.waitingChoice && !b.waitingChoice.selected)?.waitingChoice
    await writeHostContinuation(ctx, state)
    return state
  })
}
export function withHostBranch<T>(branchId: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const scope = execution.getStore()
  if (!scope || scope.branchId) throw new Error("Nested parallel is unsupported")
  return execution.run({ ...scope, branchId, io: { ...scope.io, signal } }, work)
}
export function hostFrames(state: HostContinuation, branchId?: string): HostFrame[] {
  if (!branchId) return state.frames
  const branch = state.parallel?.branches.find(b => b.id === branchId)
  if (!branch) throw new Error("Parallel branch is no longer active")
  return branch.frames
}
export async function resolveHostManifest(ctx: WorkflowContext, ref: ToolRef) {
  const registered = getToolManifest(ref)
  if (registered?.kind === "native") return registered
  return (await readInstructionTool(ctx, ref)).tool.manifest
}
export async function readInstructionTool(ctx: WorkflowContext, ref: ToolRef) {
  const runtime = new NodeFsVaultStorage(ctx.runtimeRoot)
  if (await runtime.hasSymlinkTraversal(`objects/${ref.digest}/snapshot.json`)) throw new Error("Package snapshot alias")
  const object = new NodeFsVaultStorage(extensionObjectPath(ctx, ref.digest))
  const raw = await object.read("snapshot.json")
  if (!raw) throw new Error("Missing immutable dependency")
  const { tool } = ImportedSnapshotSchema.parse(JSON.parse(raw))
  if (exactRef(tool.manifest.ref) !== exactRef(ref) || snapshotDigest(tool) !== ref.digest || !tool.reviewed || tool.hostUnsupported.length || tool.requirements.unsupported.length || tool.requirements.internalModelCalls) throw new Error("Unapproved immutable dependency")
  return { tool, object }
}
export async function readInstructionResource(ctx: WorkflowContext, ref: ToolRef, resourceId: string): Promise<string> {
  const { tool, object } = await readInstructionTool(ctx, ref)
  const record = tool.files.find(f => f.path === resourceId)
  if (!record) throw new Error("Undeclared package resource")
  if (await object.hasSymlinkTraversal("files/" + record.path)) throw new Error("Package resource alias")
  const bytes = await object.readBinary("files/" + record.path)
  if (!bytes || bytes.length !== record.bytes) throw new Error("Missing package resource")
  // Hash bytes, not a lossy decoded representation.
  if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) throw new Error("Package resource integrity mismatch")
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}
function slice(text: string, offset: number, length: number) {
  if (offset > text.length) throw new Error("Resource page exceeds length")
  return { text: text.slice(offset, offset + length), offset, total: text.length, nextOffset: offset + length < text.length ? offset + length : null }
}
export async function dispatchHostAction(ctx: WorkflowContext, runId: string, action: HostAction): Promise<HostActionResult> {
  const scope = execution.getStore()
  if (!scope || scope.ctx !== ctx || scope.id !== runId) throw new Error("Action requires owned host execution")
  scope.io.signal.throwIfAborted()
  UuidSchema.parse(action.id)
  const { id, ...candidate } = action
  const decision = HostDecisionSchema.parse(candidate)
  const state = await readHostContinuation(ctx, runId), frame = state && hostFrames(state, scope.branchId).at(-1)
  if (!state || !frame || id !== hostStepId(frame, "action") || canonicalJson(frame.decision) !== canonicalJson(decision)) throw new Error("Host action does not match the persisted parent step")
  const run = (await readRun(ctx, runId))!
  const { tool } = await readInstructionTool(ctx, frame.tool)
  switch (decision.type) {
    case "read_artifact": {
      if (!run.artifacts.some(artifact => artifact.id === decision.artifactId)) throw new Error("Artifact is outside the current root")
      const { metadata, bytes } = await readArtifact(ctx, runId, decision.artifactId)
      if (!["text/markdown", "text/plain", "application/json", "application/x-bibtex", "text/x-bibtex"].includes(metadata.mediaType)) throw new Error("Artifact is not supported textual evidence")
      return { status: "ok", value: { artifactId: metadata.id, sourceRefs: metadata.sourceRefs, ...slice(new TextDecoder("utf-8", { fatal: true }).decode(bytes), decision.offset, decision.length) } }
    }
    case "read_resource": return { status: "ok", value: slice(await readInstructionResource(ctx, frame.tool, decision.resourceId), decision.offset, decision.length) }
    case "read_research": {
      const view = await buildResearchView(ctx, runId)
      const resource = view.resources.find(r => r.id === decision.resourceId)
      if (!resource) throw new Error("Unknown research resource")
      return { status: "ok", value: { sourceRef: resource.sourceRef, ...slice(resource.text, decision.offset, decision.length) } }
    }
    case "parallel": {
      if (scope.branchId || state.parallel) throw new Error("Nested parallel is unsupported")
      for (const branch of decision.branches) {
        if (!tool.manifest.dependencies.some(ref => exactRef(ref) === exactRef(branch.tool)) || !run.dependencies.some(ref => exactRef(ref) === exactRef(branch.tool))) throw new Error("Undeclared parallel helper dependency")
        const helper = await resolveHostManifest(ctx, branch.tool)
        if (helper.engines.length && !helper.engines.includes(run.model.engine)) throw new Error("Captured model unavailable for helper")
        validateInputSchema(helper.inputSchema).parse(branch.input)
      }
      return { status: "parallel", branches: decision.branches }
    }
    case "invoke_skill": {
      let selected: ToolRef | undefined
      if (decision.slotId) {
        if (decision.tool) throw new Error("A model cannot choose a capability candidate")
        const slot = tool.proposal.dependencySlots.find(s => s.id === decision.slotId)
        if (!slot) throw new Error("Undeclared helper capability")
        const branch = state.parallel?.branches.find(b => b.id === scope.branchId)
        const choice = (branch ? branch.waitingChoice : state.waitingChoice) ?? state.choices.find(c => c.id === id)
        if (choice && (choice.id !== id || choice.parentFrameId !== frame.id || choice.slotId !== slot.id || canonicalJson(choice.candidates) !== canonicalJson(slot.eligible))) throw new Error("Helper choice parent conflict")
        selected = choice?.selected ?? (slot.eligible.length === 1 ? slot.eligible[0] : undefined)
        if (selected && !slot.eligible.some(ref => exactRef(ref) === exactRef(selected!))) throw new Error("Undeclared helper candidate")
        const pending = { id, parentFrameId: frame.id, slotId: slot.id, candidates: slot.eligible, ...(selected ? { selected } : {}), ...(branch ? { batchId: state.parallel!.actionId, branchId: branch.id } : {}) }
        await updateHostContinuation(ctx, runId, next => {
          if (scope.branchId) next.parallel!.branches.find(b => b.id === scope.branchId)!.waitingChoice = pending
          else next.waitingChoice = pending
          if (selected && !next.choices.some(c => c.id === id)) next.choices.push(pending)
        })
        if (!selected) return { status: "needs-choice", choice: pending }
      } else {
        selected = decision.tool
        if (!selected || !tool.manifest.dependencies.some(ref => exactRef(ref) === exactRef(selected!))) throw new Error("Undeclared helper dependency")
      }
      if (!run.dependencies.some(ref => exactRef(ref) === exactRef(selected!))) throw new Error("Helper is outside captured run scope")
      const helper = await resolveHostManifest(ctx, selected)
      if (helper.engines.length && !helper.engines.includes(run.model.engine)) throw new Error("Captured model unavailable for helper")
      validateInputSchema(helper.inputSchema).parse(decision.input)
      return { status: "invoke", tool: selected, input: decision.input }
    }
    case "run_command": {
      const command = tool.proposal.executionCommands?.find(c => c.id === decision.commandId)
      if (!command) throw new Error("Undeclared command recipe")
      if (!tool.files.some(f => f.path === command.entrypoint)) throw new Error("Command entrypoint is outside approved snapshot")
      const prepared = await resolveCapturedToolEnvironment(ctx, run, frame.tool)
      if (!prepared.executablePaths[command.executableId as keyof typeof prepared.executablePaths]) throw new Error("Prepared runtime does not match command")
      const view = await buildResearchView(ctx, runId)
      const bindings = await Promise.all(run.connectionConfigurationRefs.map(ref => readConnectionRevision(ctx, ref)))
      const allowed = bindings.filter(b => tool.manifest.connections.includes(b.service))
      if (allowed.length !== tool.manifest.connections.length) throw new Error("Captured connections unavailable")
      const broker = allowed.length ? await createConnectionBroker(ctx, runId, allowed) : undefined
      try {
        const commandContext = await createCommandContext(ctx, { kind: "run", id: runId, packageDigest: frame.tool.digest,
          executablePaths: Object.fromEntries(Object.entries(prepared.executablePaths).filter((entry): entry is [string, string] => typeof entry[1] === "string")), runtimeReadRoots: prepared.runtimeReadRoots, resourceIds: view.resources.map(r => r.id), connectionIds: allowed.map(b => b.id) }, broker)
        // Node resolves dependencies next to its entrypoint. Python uses the venv
        // interpreter from captured preparation. Neither path comes from a model.
        const argv = [...(command.executableId === "python" ? ["-I"] : []), join(prepared.projectRoot, command.entrypoint), ...command.argv]
        return { status: "ok", value: await runIsolatedCommand(commandContext, runId, { id, executableId: command.executableId, argv, cwd: ".", resourceIds: view.resources.map(r => r.id), connectionIds: allowed.map(b => b.id) }, scope.io.signal) }
      } finally { await broker?.close() }
    }
    case "publish_artifact": {
      if (!tool.manifest.outputKinds.includes(decision.kind)) throw new Error("Undeclared output kind")
      const { text, kind, title, mediaType, sourceRefs } = decision
      const input = { kind, title, mediaType, sourceRefs }
      return { status: "ok", value: await scope.io.publishArtifact({ ...input, bytes: Buffer.from(text) }) }
    }
    case "propose_wiki_change": await scope.io.submitWikiProposal(decision.proposal); return { status: "ok", value: "Proposal registered; coordinator owns authorization and save." }
    case "finish": {
      if (decision.artifactIds.some(id => !run.artifacts.some(a => a.id === id))) throw new Error("Finish references an unpublished artifact")
      if (!decision.synthesize && exactRef(frame.tool) === exactRef(run.tool) && !decision.artifactIds.length) throw new Error("Root finish requires artifacts or synthesis")
      return { status: "finish", summary: decision.summary, synthesize: decision.synthesize }
    }
  }
}
// Keep the imported schema dependency explicit for callers inspecting snapshots.
export type InstructionTool = z.infer<typeof ImportToolSchema>

/** Prepare a human choice against the immutable parent frame/declared slot.
 * The journal owns exclusion, the winner receipt and queue publication. */
export async function prepareHostHelperChoice(ctx: WorkflowContext, run: import("./contracts").ToolRun, choiceId: string, tool: ToolRef): Promise<HostContinuation> {
  const state = await readHostContinuation(ctx, run.id), choice = state?.waitingChoice
  if (!state || state.completed || !choice || choice.id !== choiceId) throw new Error("Supporting choice is stale")
  const branch = choice.branchId ? state.parallel?.branches.find(b => b.id === choice.branchId) : undefined
  if (choice.branchId && (!branch || choice.batchId !== state.parallel?.actionId || branch.waitingChoice?.id !== choice.id)) throw new Error("Supporting choice branch changed")
  const frame = (branch?.frames ?? state.frames).at(-1)
  if (!frame || frame.id !== choice.parentFrameId || frame.decision?.type !== "invoke_skill" || frame.decision.slotId !== choice.slotId || choice.id !== hostStepId(frame, "action")) throw new Error("Supporting choice parent changed")
  const parent = await readInstructionTool(ctx, frame.tool)
  const slot = parent.tool.proposal.dependencySlots.find(s => s.id === choice.slotId)
  if (!slot || canonicalJson(slot.eligible) !== canonicalJson(choice.candidates) || !choice.candidates.some(t => exactRef(t) === exactRef(tool)) || !run.dependencies.some(t => exactRef(t) === exactRef(tool))) throw new Error("Helper is outside the captured declared slot")
  if (choice.selected && exactRef(choice.selected) !== exactRef(tool)) throw new Error("Supporting choice already selected")
  const selected = await resolveHostManifest(ctx, tool)
  if (selected.engines.length && !selected.engines.includes(run.model.engine)) throw new Error("Captured engine unavailable")
  choice.selected = tool
  if (branch) branch.waitingChoice = choice
  return state
}
