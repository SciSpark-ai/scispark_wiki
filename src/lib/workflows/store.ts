import { z } from "zod"
import { DigestSchema, ProfileIdSchema, UuidSchema } from "../extensions/contracts"
import { withVaultExclusive } from "../vault/exclusive"
import type { WorkflowContext } from "./context"
import { RunEventInputSchema, RunEventSchema, ToolRunSchema, type RunEvent, type RunEventInput, type ToolRun } from "./contracts"

function runRoot(ctx: WorkflowContext, id: string): string {
  ProfileIdSchema.parse(ctx.profileId)
  DigestSchema.parse(ctx.vaultId)
  return `.scispark/tool-runs/${UuidSchema.parse(id)}`
}
function assertOwner(ctx: WorkflowContext, run: ToolRun): void {
  if (run.profileId !== ctx.profileId || run.vaultId !== ctx.vaultId) throw new Error("Workflow owner mismatch")
}
export async function readRun(ctx: WorkflowContext, id: string): Promise<ToolRun | null> {
  const raw = await ctx.storage.read(`${runRoot(ctx, id)}/run.json`)
  if (raw === null) return null
  const run = ToolRunSchema.parse(JSON.parse(raw))
  assertOwner(ctx, run)
  if (run.id !== id) throw new Error("Workflow identity mismatch")
  return run
}
const IMMUTABLE_FIELDS = ["schemaVersion", "id", "profileId", "vaultId", "operationId", "tool", "dependencies", "input", "sessionId", "contextRefs", "model", "preparedEnvironmentRefs", "connectionConfigurationRefs", "writeIntent", "createdAt", "nativeRunRef"] as const
export async function writeRun(ctx: WorkflowContext, input: ToolRun): Promise<void> {
  const run = ToolRunSchema.parse(input)
  const root = runRoot(ctx, run.id)
  assertOwner(ctx, run)
  await withVaultExclusive(ctx.storage, `workflow-${run.id}`, async () => {
    const previous = await readRun(ctx, run.id)
    if (previous) {
      if (previous.status !== run.status && await ctx.storage.read(`${root}/journal.json`) !== null) {
        throw new Error("Workflow lifecycle is owned by the coordinator journal")
      }
      if (await ctx.storage.read(`${root}/usage.json`) !== null
        && (JSON.stringify(previous.usage) !== JSON.stringify(run.usage) || JSON.stringify(previous.allowance) !== JSON.stringify(run.allowance))) {
        throw new Error("Workflow usage and allowance are owned by the attempt journal")
      }
      if (IMMUTABLE_FIELDS.some((field) => JSON.stringify(previous[field]) !== JSON.stringify(run[field]))) throw new Error("Workflow snapshot is immutable")
      if (run.eventCursor < previous.eventCursor || Object.keys(previous.usage).some((key) => {
        const field = key as keyof ToolRun["usage"]
        const before = previous.usage[field]
        const after = run.usage[field]
        return before !== null && (after === null || after < before)
      })) throw new Error("Workflow cumulative usage and cursor cannot decrease")
    }
    await ctx.storage.write(`${root}/run.json`, JSON.stringify(run, null, 2))
  })
}
export async function listRunEvents(ctx: WorkflowContext, id: string, after: number): Promise<RunEvent[]> {
  z.number().int().nonnegative().safe().parse(after)
  const root = runRoot(ctx, id)
  if (await readRun(ctx, id) === null) return []
  const paths = await ctx.storage.list(`${root}/events/`)
  const events: RunEvent[] = []
  for (const path of paths) {
    const file = path.slice(`${root}/events/`.length)
    if (!/^[0-9]{16}\.json$/.test(file)) continue // Atomic-write temporary files are not events.
    const raw = await ctx.storage.read(path)
    if (raw === null) throw new Error("Workflow event disappeared")
    const event = RunEventSchema.parse(JSON.parse(raw))
    if (event.runId !== id || Number(file.slice(0, -5)) !== event.seq) throw new Error("Workflow event identity mismatch")
    if (event.seq > after) events.push(event)
  }
  return events.sort((a, b) => a.seq - b.seq)
}
export async function appendEvent(ctx: WorkflowContext, id: string, input: RunEventInput): Promise<RunEvent> {
  const payload = RunEventInputSchema.parse(input)
  const root = runRoot(ctx, id)
  return withVaultExclusive(ctx.storage, `workflow-${id}`, async () => {
    const run = await readRun(ctx, id)
    if (run === null) throw new Error("Workflow run not found")
    // Event is committed first. After a crash, its durable sequence takes
    // precedence over a stale cursor; a retry never overwrites that event.
    const events = await listRunEvents(ctx, id, 0)
    const seq = Math.max(run.eventCursor, events.at(-1)?.seq ?? 0) + 1
    const event = RunEventSchema.parse({ ...payload, runId: id, seq })
    await ctx.storage.write(`${root}/events/${String(seq).padStart(16, "0")}.json`, JSON.stringify(event))
    await ctx.storage.write(`${root}/run.json`, JSON.stringify({ ...run, eventCursor: seq }, null, 2))
    return event
  })
}
