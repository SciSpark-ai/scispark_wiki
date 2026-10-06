import { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { startRun } from "../workflows/coordinator"
import { readRun } from "../workflows/store"
import type { ToolRun } from "../workflows/contracts"
import { withVaultExclusive } from "../vault/exclusive"
import { loadSession, saveSession } from "../chat/session"
import { ToolChoiceSchema, ToolIntentInputSchema, ChooseToolInputSchema, UuidSchema, type ToolChoice, type ToolIntentInput, type ToolRef } from "./contracts"
import { exactRef } from "./dependencies"
import { listToolLibrary } from "./library"
import { candidateSummary, deriveWriteIntent, intentOperationId, toolRunInput } from "./intent"
const ChoiceRecordSchema = z.object({ profileId: z.string(), vaultId: z.string(), choice: ToolChoiceSchema, input: ToolIntentInputSchema,
  winner: ChooseToolInputSchema.extend({ runId: UuidSchema.optional() }).strict().optional(),
}).strict()
const path = (id: string) => `.scispark/tools/choices/${UuidSchema.parse(id)}.json`
export class ToolChoiceConflict extends Error {
  readonly status = 409
  constructor(readonly choice: ToolChoice, message = "This choice changed. Select an available tool.") { super(message) }
}
export async function saveToolChoice(ctx: WorkflowContext, choice: ToolChoice, input: ToolIntentInput) {
  if (await ctx.storage.read(path(choice.id))) return
  await ctx.storage.write(path(choice.id), JSON.stringify(ChoiceRecordSchema.parse({ profileId: ctx.profileId, vaultId: ctx.vaultId, choice, input })))
}
async function load(ctx: WorkflowContext, id: string) {
  const raw = await ctx.storage.read(path(id))
  if (raw === null) throw new Error("Tool choice not found")
  const record = ChoiceRecordSchema.parse(JSON.parse(raw))
  if (record.choice.id !== id || record.profileId !== ctx.profileId || record.vaultId !== ctx.vaultId) throw new Error("Choice owner mismatch")
  return record
}
async function publishRun(ctx: WorkflowContext, sessionId: string, choiceId: string, run: ToolRun) {
  await withVaultExclusive(ctx.storage, `chat-${sessionId}`, async () => {
    const session = await loadSession(ctx.storage, sessionId)
    if (!session) return
    for (const message of session.messages) message.blocks = message.blocks?.map(block => block.type === "tool-choice" && block.choice.id === choiceId
      ? { type: "tool-run", runId: run.id, tool: run.tool } : block)
    await saveSession(ctx.storage, session)
  })
}
/** Winner receipt precedes root creation; a lost start response repairs through
 * the coordinator's immutable start operation. No second selection can dispatch. */
export async function chooseTool(ctx: WorkflowContext, choiceId: string, tool: ToolRef, operationId: string): Promise<ToolRun> {
  const selection = ChooseToolInputSchema.parse({ tool, operationId })
  return withVaultExclusive(ctx.storage, `tool-choice-${UuidSchema.parse(choiceId)}`, async () => {
    const record = await load(ctx, choiceId)
    if (record.winner && (exactRef(record.winner.tool) !== exactRef(selection.tool) || record.winner.operationId !== selection.operationId)) throw new ToolChoiceConflict(record.choice, "Another selection already owns this request.")
    if (record.winner?.runId) {
      const run = await readRun(ctx, record.winner.runId)
      if (!run) throw new Error("Workflow run not found")
      await publishRun(ctx, record.input.sessionId, choiceId, run)
      return run
    }
    if (!record.winner) {
      const ready = (await listToolLibrary(ctx)).tools.filter(t => t.enabled && t.readiness.status === "ready")
      const offered = record.choice.candidates.find(c => exactRef(c.tool) === exactRef(tool))
      if (!offered || !ready.some(t => exactRef(t.ref) === exactRef(tool))) {
        record.choice.candidates = ready.filter(t => record.choice.candidates.some(c => exactRef(c.tool) === exactRef(t.ref))).map(candidateSummary)
        await ctx.storage.write(path(choiceId), JSON.stringify(record))
        throw new ToolChoiceConflict(record.choice)
      }
      record.winner = selection
      await ctx.storage.write(path(choiceId), JSON.stringify(record))
    }
    const run = await startRun(ctx, {
      operationId: intentOperationId(record.input.sessionId, record.input.operationId), tool,
      input: toolRunInput(record.input, tool),
      sessionId: record.input.sessionId, contextRefs: record.input.contextRefs, writeIntent: deriveWriteIntent(record.input.question),
    })
    record.winner!.runId = run.id
    await ctx.storage.write(path(choiceId), JSON.stringify(record))
    await publishRun(ctx, record.input.sessionId, choiceId, run)
    return run
  })
}
