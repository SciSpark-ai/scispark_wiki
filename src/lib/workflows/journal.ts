import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { DigestSchema, UuidSchema } from "../extensions/contracts"
import { withVaultExclusive } from "../vault/exclusive"
import { processIsAlive } from "../vault/node-fs-storage"
import type { WorkflowContext } from "./context"
import { RunEventInputSchema, RunEventSchema, RunStatusSchema, StepIntentSchema, UsageJournalSchema, WorkflowJournalSchema,
  type RunEventInput, type RunStatus, type StepIntent, type ToolRun, type WorkflowJournal, type WorkflowLease } from "./contracts"
import { readRunEventTail, readRun } from "./store"
import { WorkflowLimitError } from "./usage"

const runtime = globalThis as typeof globalThis & { __scisparkWorkflowProcessId?: string }
const processId = runtime.__scisparkWorkflowProcessId ??= randomUUID()
export const LEASE_MILLISECONDS = 30_000
export type { WorkflowJournal, WorkflowLease } from "./contracts"
const StepSchema = z.object({
  schemaVersion: z.literal(1), runId: UuidSchema, intent: StepIntentSchema, leaseId: UuidSchema,
  state: z.enum(["not_started", "pending", "completed"]), response: z.string().optional(), responseHash: DigestSchema.optional(),
}).strict()
const root = (id: string) => `.scispark/tool-runs/${UuidSchema.parse(id)}`
export const workflowHash = (value: string) => createHash("sha256").update(value).digest("hex")
/** Stable JSON is also the durable operation/intent conflict boundary. */
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)])) : v
  return JSON.stringify(normalize(value))
}
async function state(ctx: WorkflowContext, id: string): Promise<{ run: ToolRun; journal: WorkflowJournal }> {
  const run = await readRun(ctx, id)
  if (!run) throw new Error("Workflow run not found")
  const raw = await ctx.storage.read(`${root(id)}/journal.json`)
  const journal = raw === null ? WorkflowJournalSchema.parse({ schemaVersion: 1, runId: id, profileId: ctx.profileId, vaultId: ctx.vaultId,
    status: run.status, lease: null, actions: [] }) : WorkflowJournalSchema.parse(JSON.parse(raw))
  if (journal.runId !== id || journal.profileId !== ctx.profileId || journal.vaultId !== ctx.vaultId) throw new Error("Workflow journal owner mismatch")
  return { run, journal }
}
async function eventUnderLock(ctx: WorkflowContext, run: ToolRun, input: RunEventInput): Promise<ToolRun> {
  const tail = await readRunEventTail(ctx, run.id)
  const seq = Math.max(run.eventCursor, tail?.seq ?? 0) + 1
  const event = RunEventSchema.parse({ ...RunEventInputSchema.parse(input), runId: run.id, seq })
  await ctx.storage.write(`${root(run.id)}/events/${String(seq).padStart(16, "0")}.json`, JSON.stringify(event))
  return { ...run, eventCursor: seq, updatedAt: new Date().toISOString() }
}
/** Lifecycle journal commits before its run mirror and public status event. Readers
 * repair either interrupted write, including an event already committed on disk. */
async function persist(ctx: WorkflowContext, run: ToolRun, journal: WorkflowJournal): Promise<ToolRun> {
  const serialized = JSON.stringify(WorkflowJournalSchema.parse(journal))
  if (await ctx.storage.read(`${root(run.id)}/journal.json`) !== serialized) await ctx.storage.write(`${root(run.id)}/journal.json`, serialized)
  const tail = await readRunEventTail(ctx, run.id)
  if (!tail || (run.status !== journal.status && !(tail.type === "status" && tail.status === journal.status))) run = await eventUnderLock(ctx, run, { type: "status", status: journal.status })
  const changed = run.status !== journal.status || run.eventCursor < (tail?.seq ?? 0)
  const updated = { ...run, status: journal.status, eventCursor: Math.max(run.eventCursor, tail?.seq ?? 0), updatedAt: changed ? new Date().toISOString() : run.updatedAt }
  const runJson = JSON.stringify(updated, null, 2)
  if (await ctx.storage.read(`${root(run.id)}/run.json`) !== runJson) await ctx.storage.write(`${root(run.id)}/run.json`, runJson)
  return updated
}
function assertLease(journal: WorkflowJournal, lease: WorkflowLease): void {
  if (!journal.lease || journal.lease.id !== lease.id || journal.lease.processId !== lease.processId || journal.lease.pid !== lease.pid) throw new Error("Workflow lease no longer owned")
}
export function leaseOwnerAlive(lease: WorkflowLease | null): boolean {
  // Expiry is diagnostic only. A suspended/event-loop-blocked owner may still
  // finish external work. Reused PIDs conservatively fail closed as well.
  return lease !== null && processIsAlive(lease.pid)
}
export async function readWorkflowJournal(ctx: WorkflowContext, id: string): Promise<WorkflowJournal> {
  return withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    await persist(ctx, run, journal)
    return journal
  })
}
export async function claimRunLease(ctx: WorkflowContext, id: string): Promise<WorkflowLease | null> {
  return withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    if (journal.cancelRequested || leaseOwnerAlive(journal.lease) || !["queued", "running", "interrupted"].includes(journal.status)) return null
    const lease = { id: randomUUID(), processId, pid: process.pid, expiresAt: Date.now() + LEASE_MILLISECONDS }
    journal.lease = lease; journal.status = "running"
    await persist(ctx, run, journal)
    return lease
  })
}
export async function renewRunLease(ctx: WorkflowContext, id: string, lease: WorkflowLease): Promise<RunStatus> {
  return withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    assertLease(journal, lease)
    journal.lease!.expiresAt = Date.now() + LEASE_MILLISECONDS
    await persist(ctx, run, journal)
    return journal.status
  })
}
export async function releaseRunLease(ctx: WorkflowContext, id: string, lease: WorkflowLease): Promise<void> {
  await withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    if (journal.lease?.id !== lease.id) return
    assertLease(journal, lease); journal.lease = null
    await persist(ctx, run, journal)
  })
}
export async function transitionRun(ctx: WorkflowContext, id: string, status: RunStatus, lease?: WorkflowLease): Promise<ToolRun> {
  RunStatusSchema.parse(status)
  return withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    if (journal.cancelRequested) throw new Error("Workflow cancellation is pending")
    if (lease) {
      assertLease(journal, lease)
      if (journal.status !== "running") throw new Error("Workflow is not running")
    }
    if (["completed", "failed", "cancelled"].includes(journal.status) && status !== journal.status) throw new Error("Workflow run is terminal")
    journal.status = status
    return persist(ctx, run, journal)
  })
}
export async function actionOnRun(ctx: WorkflowContext, id: string, operationId: string, type: "cancel" | "resume"): Promise<ToolRun> {
  UuidSchema.parse(operationId)
  return withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    const usageRaw = await ctx.storage.read(`${root(id)}/usage.json`)
    if (usageRaw !== null) {
      const usage = UsageJournalSchema.parse(JSON.parse(usageRaw))
      if (usage.runId !== id || usage.profileId !== ctx.profileId || usage.vaultId !== ctx.vaultId) throw new Error("Workflow usage owner mismatch")
      if (usage.extensions.some(e => e.operationId === operationId)) throw new Error("Workflow action operation conflict")
    }
    const previous = journal.actions.find(a => a.operationId === operationId)
    if (previous) {
      if (previous.type !== type) throw new Error("Workflow action operation conflict")
      if (type === "cancel" && journal.cancelRequested && !leaseOwnerAlive(journal.lease)) {
        delete journal.cancelRequested; journal.status = "cancelled"
      }
      return persist(ctx, run, journal)
    }
    if (type === "cancel") {
      if (["completed", "failed"].includes(journal.status)) throw new Error("Workflow run is terminal")
      if (journal.status !== "cancelled" && leaseOwnerAlive(journal.lease)) journal.cancelRequested ??= operationId
      else { delete journal.cancelRequested; journal.status = "cancelled" }
    } else {
      if (journal.cancelRequested) throw new Error("Workflow cancellation is pending")
      if (journal.status === "needs_attention") throw new Error("Reconcile the uncertain outcome before resuming")
      if (journal.status === "waiting_for_choice") throw new Error("Resolve the required choice before resuming")
      if (!["paused_limit", "interrupted", "waiting_for_setup"].includes(journal.status)) throw new Error("Workflow cannot resume in its current state")
      if (leaseOwnerAlive(journal.lease)) throw new Error("Workflow owner is still stopping")
      journal.status = "queued"
    }
    journal.actions.push({ operationId, type })
    return persist(ctx, run, journal)
  })
}
export async function emitRunEvent(ctx: WorkflowContext, id: string, lease: WorkflowLease, event: RunEventInput): Promise<void> {
  const input = RunEventInputSchema.parse(event)
  if (input.type === "status") {
    if (!["waiting_for_choice", "waiting_for_setup", "paused_limit", "needs_attention"].includes(input.status)) throw new Error("Adapter cannot set a coordinator lifecycle status")
    await transitionRun(ctx, id, input.status, lease)
    return
  }
  await withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    assertLease(journal, lease)
    if (journal.status !== "running") throw new Error("Workflow is not running")
    const updated = await eventUnderLock(ctx, run, input)
    await persist(ctx, updated, journal)
  })
}
function replaySafe(intent: StepIntent): boolean {
  return (intent.kind === "read" && intent.replay === "read_only") || (intent.kind === "wiki_write" && intent.replay === "idempotent")
}
export class UncertainWorkflowError extends Error {}
export async function journalStep<T>(ctx: WorkflowContext, id: string, lease: WorkflowLease, input: StepIntent, work: () => Promise<T>): Promise<T> {
  const intent = StepIntentSchema.parse(input)
  const path = `${root(id)}/steps/${intent.id}.json`
  const prepared = await withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { journal } = await state(ctx, id)
    assertLease(journal, lease)
    if (journal.cancelRequested) throw new Error("Workflow cancellation is pending")
    if (journal.status !== "running") throw new Error("Workflow is not running")
    const raw = await ctx.storage.read(path)
    if (raw !== null) {
      const previous = StepSchema.parse(JSON.parse(raw))
      if (previous.runId !== id || canonicalJson(previous.intent) !== canonicalJson(intent)) throw new Error("Workflow step identity conflict")
      if (previous.state === "completed") {
        if (previous.response === undefined || workflowHash(previous.response) !== previous.responseHash) throw new UncertainWorkflowError("Checkpoint response hash mismatch")
        return { cached: true as const, value: (JSON.parse(previous.response) as { value: T }).value }
      }
      if (previous.state === "pending" && !replaySafe(intent)) throw new UncertainWorkflowError("Pending step requires reconciliation")
      // A repeated step in the same live adapter is not a second dispatch.
      if (previous.state === "pending" && previous.leaseId === lease.id) throw new Error("Workflow step is already pending in this owner")
    }
    await ctx.storage.write(path, JSON.stringify(StepSchema.parse({ schemaVersion: 1, runId: id, intent, leaseId: lease.id, state: "pending" })))
    return { cached: false as const }
  })
  if (prepared.cached) return prepared.value
  let value: T
  try { value = await work() } // Never hold state exclusivity across external work.
  catch (error) {
    if (error instanceof WorkflowLimitError && error.runId === id && error.stepId === intent.id) {
      await withVaultExclusive(ctx.storage, `workflow-${id}`, async () => {
        const { journal } = await state(ctx, id)
        assertLease(journal, lease)
        await ctx.storage.write(path, JSON.stringify(StepSchema.parse({ schemaVersion: 1, runId: id, intent, leaseId: lease.id, state: "not_started" })))
      })
    }
    throw error
  }
  const response = canonicalJson({ value })
  await withVaultExclusive(ctx.storage, `workflow-${id}`, async () => {
    const { journal } = await state(ctx, id)
    assertLease(journal, lease)
    await ctx.storage.write(path, JSON.stringify(StepSchema.parse({ schemaVersion: 1, runId: id, intent, leaseId: lease.id,
      state: "completed", response, responseHash: workflowHash(response) })))
  })
  return value
}
/** Dispatched attempts without settlement are uncertain even when the adapter
 * crashed before writing its step record or explicitly marking unknown usage. */
export async function hasUncertainWork(ctx: WorkflowContext, id: string): Promise<boolean> {
  const run = await readRun(ctx, id)
  if (!run) throw new Error("Workflow run not found")
  const rawUsage = await ctx.storage.read(`${root(id)}/usage.json`)
  if (rawUsage !== null) {
    const usage = UsageJournalSchema.parse(JSON.parse(rawUsage))
    if (usage.runId !== id || usage.profileId !== ctx.profileId || usage.vaultId !== ctx.vaultId) throw new Error("Workflow usage owner mismatch")
    if (usage.attempts.some(a => a.state === "unknown" || (a.dispatchedAt && a.state !== "known"))) return true
  }
  for (const path of await ctx.storage.list(`${root(id)}/steps/`)) {
    if (!/\/[0-9a-f-]{36}\.json$/.test(path)) continue
    const raw = await ctx.storage.read(path)
    if (raw === null) throw new Error("Workflow checkpoint disappeared")
    const record = StepSchema.parse(JSON.parse(raw))
    if (record.runId !== id || path !== `${root(id)}/steps/${record.intent.id}.json`) throw new Error("Workflow checkpoint identity mismatch")
    if (record.state === "pending" && !replaySafe(record.intent)) return true
    if (record.state === "completed" && (record.response === undefined || workflowHash(record.response) !== record.responseHash)) return true
  }
  return false
}

/** Observation projects committed lifecycle authority without creating or repairing records. */
export async function projectWorkflowRun(ctx: WorkflowContext, id: string): Promise<ToolRun & { cancelRequested: boolean }> {
  const { run, journal } = await state(ctx, id)
  const tail = await readRunEventTail(ctx, id)
  return { ...run, status: journal.status, eventCursor: Math.max(run.eventCursor, tail?.seq ?? 0), cancelRequested: journal.cancelRequested !== undefined }
}

/** The owning lease can flush while cancellation fences dispatch. Only that
 * owner may acknowledge a live intent; dead owners are finalized by actionOnRun. */
export async function runCancellationRequested(ctx: WorkflowContext, id: string, lease: WorkflowLease): Promise<boolean> {
  const { journal } = await state(ctx, id)
  assertLease(journal, lease)
  return journal.cancelRequested !== undefined
}
export async function acknowledgeRunCancellation(ctx: WorkflowContext, id: string, lease: WorkflowLease): Promise<void> {
  await withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(id)}`, async () => {
    const { run, journal } = await state(ctx, id)
    assertLease(journal, lease)
    if (!journal.cancelRequested) return
    delete journal.cancelRequested
    journal.status = "cancelled"
    await persist(ctx, run, journal)
  })
}
