import { randomUUID } from "node:crypto"
import { UuidSchema } from "../extensions/contracts"
import { Meter } from "../llm/metering"
import { loadSettings } from "../llm/settings"
import { withVaultExclusive } from "../vault/exclusive"
import type { WorkflowContext } from "./context"
import { AttemptEstimateSchema, AttemptResultSchema, AttemptTicketSchema, RunAllowanceSchema, StepIntentSchema, ToolRunSchema, UsageJournalSchema, WorkflowJournalSchema,
  type AttemptEstimate, type AttemptResult, type AttemptTicket, type RunAllowance, type RunUsage, type StepIntent, type ToolRun, type UsageJournal } from "./contracts"
import { readRun } from "./store"

/** A rejected reservation has not authorized or dispatched external work. */
export class WorkflowLimitError extends Error {
  constructor(message: string, readonly runId: string, readonly stepId: string) { super(message) }
}

const usagePath = (id: string) => `.scispark/tool-runs/${UuidSchema.parse(id)}/usage.json`
async function state(ctx: WorkflowContext, id: string): Promise<{ run: ToolRun; journal: UsageJournal; cancellationPending: boolean }> {
  let run = await readRun(ctx, id)
  if (!run) throw new Error("Workflow run not found")
  // Every caller holds workflow-<id>. Lifecycle commits precede the run mirror,
  // so authorization must read its authoritative status without a nested lock.
  let cancellationPending = false
  const lifecycleRaw = await ctx.storage.read(`.scispark/tool-runs/${UuidSchema.parse(id)}/journal.json`)
  if (lifecycleRaw !== null) {
    const lifecycle = WorkflowJournalSchema.parse(JSON.parse(lifecycleRaw))
    if (lifecycle.runId !== id || lifecycle.profileId !== ctx.profileId || lifecycle.vaultId !== ctx.vaultId) throw new Error("Workflow journal owner mismatch")
    run = { ...run, status: lifecycle.status }
    cancellationPending = lifecycle.cancelRequested !== undefined
  }
  const raw = await ctx.storage.read(usagePath(id))
  const journal = raw === null ? UsageJournalSchema.parse({ schemaVersion: 1, runId: id, profileId: ctx.profileId, vaultId: ctx.vaultId,
    baseUsage: run.usage, allowance: run.allowance, attempts: [], extensions: [] }) : UsageJournalSchema.parse(JSON.parse(raw))
  if (journal.runId !== id || journal.profileId !== ctx.profileId || journal.vaultId !== ctx.vaultId) throw new Error("Workflow usage owner mismatch")
  return { run, journal, cancellationPending }
}
function totals(journal: UsageJournal, subscription: boolean): RunUsage {
  const usage: RunUsage = { ...journal.baseUsage, costUsd: subscription ? null : journal.baseUsage.costUsd,
    heldCostUsd: 0, heldActiveSeconds: 0, heldAttempts: 0, uncertain: false }
  for (const { ticket, state, result } of journal.attempts) {
    if (state === "not_dispatched") continue
    usage.modelCalls += Math.max(ticket.estimate.modelCalls, result?.modelCalls ?? 0)
    usage.commandCalls += Math.max(ticket.estimate.commandCalls, result?.commandCalls ?? 0)
    if (state === "known") {
      usage.activeSeconds += result!.activeSeconds
      if (!subscription) usage.costUsd = usage.costUsd === null || result!.costUsd === null ? null : usage.costUsd + result!.costUsd
    } else {
      usage.heldAttempts++
      usage.heldActiveSeconds += Math.max(ticket.estimate.activeSeconds, result?.activeSeconds ?? 0)
      usage.heldCostUsd += Math.max(ticket.estimate.costUsd ?? 0, result?.costUsd ?? 0)
      usage.uncertain ||= state === "unknown"
    }
  }
  return usage
}
/** Journal first: a crash before the run mirror write cannot refund usage or an extension. */
async function persist(ctx: WorkflowContext, run: ToolRun, journal: UsageJournal): Promise<ToolRun> {
  UsageJournalSchema.parse(journal)
  const usage = totals(journal, run.model.engine !== "api")
  const updated = ToolRunSchema.parse({ ...run, allowance: journal.allowance, usage: { modelCalls: usage.modelCalls, commandCalls: usage.commandCalls,
    activeSeconds: usage.activeSeconds, costUsd: usage.costUsd }, updatedAt: new Date().toISOString() })
  await ctx.storage.write(usagePath(run.id), JSON.stringify(journal))
  await ctx.storage.write(`.scispark/tool-runs/${run.id}/run.json`, JSON.stringify(updated, null, 2))
  return updated
}
export async function getRunUsage(ctx: WorkflowContext, runId: string): Promise<RunUsage> {
  return withVaultExclusive(ctx.storage, `workflow-${UuidSchema.parse(runId)}`, async () => {
    const { run, journal } = await state(ctx, runId)
    return totals(journal, run.model.engine !== "api")
  })
}

/** Native callers keep their existing financial exclusion/ledger and pass owner=native.
 * Workflow callers share ai-spend with all existing API dispatch paths. */
export async function reserveAttempt(ctx: WorkflowContext, runId: string, stepInput: StepIntent, estimateInput: AttemptEstimate): Promise<AttemptTicket> {
  UuidSchema.parse(runId)
  const step = StepIntentSchema.parse(stepInput), estimate = AttemptEstimateSchema.parse(estimateInput)
  if ((step.kind === "model" && estimate.modelCalls < 1) || (step.kind === "command" && estimate.commandCalls < 1)) throw new Error("Attempt must reserve its dispatch count")
  if (estimate.activeSeconds <= 0) throw new Error("Attempt requires an active time limit")
  const reserve = () => withVaultExclusive(ctx.storage, `workflow-${runId}`, async () => {
    const { run, journal, cancellationPending } = await state(ctx, runId)
    const previous = journal.attempts.find((row) => row.ticket.step.id === step.id)
    if (previous) {
      if (JSON.stringify(previous.ticket.step) !== JSON.stringify(step) || JSON.stringify(previous.ticket.estimate) !== JSON.stringify(estimate)) throw new Error("Attempt step identity conflict")
      return previous.ticket
    }
    if (cancellationPending) throw new Error("Workflow cancellation is pending")
    if (["completed", "failed", "cancelled"].includes(run.status)) throw new Error("Workflow run is terminal")
    if (run.model.engine === "api" && estimate.modelCalls > 0 && estimate.costUsd === null) throw new Error("Configure scoped pricing before an API attempt")
    if (run.model.engine !== "api" && estimate.costUsd !== null) throw new Error("Subscription cost must remain null")
    const used = totals(journal, run.model.engine !== "api"), cap = journal.allowance
    if (used.uncertain) throw new Error("A previous attempt has an uncertain outcome; reconcile before dispatch")
    if (!["queued", "running"].includes(run.status)) throw new Error("Workflow is paused or requires user action")
    if (used.modelCalls + estimate.modelCalls > cap.modelCalls || used.commandCalls + estimate.commandCalls > cap.commandCalls
      || used.activeSeconds + used.heldActiveSeconds + estimate.activeSeconds > cap.activeSeconds
      || (cap.costUsd !== null && ((used.costUsd === null && run.model.engine === "api") || (used.costUsd ?? 0) + used.heldCostUsd + (estimate.costUsd ?? 0) > cap.costUsd))) throw new WorkflowLimitError("Workflow allowance limit reached", runId, step.id)
    if (estimate.accountingOwner === "workflow" && run.model.engine === "api" && estimate.modelCalls > 0) {
      const meter = new Meter(ctx.storage), settings = await loadSettings(ctx.storage)
      const daily = await meter.spendingToday()
      if (daily.unpricedCount) throw new Error("Daily spending includes unknown pricing")
      if (daily.knownUsd + await meter.reviewReservationsToday() + await meter.workflowReservationsToday() + await meter.nativeReservationsToday() + (estimate.costUsd ?? 0) >= settings.dailyBudgetUsd) throw new WorkflowLimitError("Daily budget limit reached", runId, step.id)
    }
    const ticket = AttemptTicketSchema.parse({ id: randomUUID(), runId, step, estimate, reservedAt: new Date().toISOString() })
    journal.attempts.push({ ticket, state: "reserved" })
    await persist(ctx, run, journal)
    return ticket
  })
  return estimate.accountingOwner === "workflow" ? withVaultExclusive(ctx.storage, "ai-spend", reserve) : reserve()
}

export async function settleAttempt(ctx: WorkflowContext, input: AttemptTicket, resultInput: AttemptResult): Promise<void> {
  const ticket = AttemptTicketSchema.parse(input), parsedResult = AttemptResultSchema.parse(resultInput)
  await withVaultExclusive(ctx.storage, `workflow-${ticket.runId}`, async () => {
    let result = parsedResult
    const { run, journal } = await state(ctx, ticket.runId)
    const row = journal.attempts.find((entry) => entry.ticket.id === ticket.id)
    if (!row || JSON.stringify(row.ticket) !== JSON.stringify(ticket)) throw new Error("Unknown or altered attempt ticket")
    if (row.state === "not_dispatched") throw new Error("A released native preparation cannot be settled as dispatched")
    if (result.outcome === "known" && ticket.estimate.accountingOwner === "native" && !result.financialLedgerRef) throw new Error("Native settlement requires its financial ledger reference")
    if (run.model.engine !== "api" && result.costUsd !== null) throw new Error("Subscription cost must remain null")
    if (row.state === "known") {
      if (JSON.stringify(row.result) !== JSON.stringify(result)) throw new Error("Attempt already settled with another result")
      await persist(ctx, run, journal)
      return
    }
    if (row.result) {
      // A second uncertain observation cannot erase already reported spending,
      // including when settlement succeeded but its run mirror write failed.
      result = AttemptResultSchema.parse({ ...row.result, ...result,
        modelCalls: Math.max(row.result.modelCalls, result.modelCalls),
        commandCalls: Math.max(row.result.commandCalls, result.commandCalls),
        activeSeconds: Math.max(row.result.activeSeconds, result.activeSeconds),
        costUsd: row.result.costUsd === null && result.costUsd === null ? null : Math.max(row.result.costUsd ?? 0, result.costUsd ?? 0),
        usage: result.usage ?? row.result.usage,
        financialLedgerRef: result.financialLedgerRef ?? row.result.financialLedgerRef })
    }
    row.result = result
    row.state = result.outcome === "unknown" || (run.model.engine === "api" && ticket.estimate.modelCalls > 0 && result.costUsd === null)
      || result.modelCalls > ticket.estimate.modelCalls || result.commandCalls > ticket.estimate.commandCalls
      || result.activeSeconds > ticket.estimate.activeSeconds || (result.costUsd ?? 0) > (ticket.estimate.costUsd ?? 0) ? "unknown" : "known"
    await persist(ctx, run, journal)
  })
}

/** R35: retain the immutable ticket, but release units only with durable host
 * proof that native dispatch never became possible. No caller-supplied refund. */
export async function releaseUndispatchedNativeAttempt(ctx: WorkflowContext, input: AttemptTicket): Promise<void> {
  const ticket = AttemptTicketSchema.parse(input)
  const { NativeFinancialLinkSchema } = await import("./native-attempt")
  const { leaseOwnerAlive } = await import("./journal")
  await withVaultExclusive(ctx.storage, `workflow-${ticket.runId}`, async () => {
    const { run, journal } = await state(ctx, ticket.runId)
    const lifecycleRaw = await ctx.storage.read(`.scispark/tool-runs/${ticket.runId}/journal.json`)
    const lifecycle = lifecycleRaw ? WorkflowJournalSchema.parse(JSON.parse(lifecycleRaw)) : null
    if (lifecycle && (leaseOwnerAlive(lifecycle.lease) || lifecycle.cancelRequested)) throw new Error("Wait for the owning workflow to stop")
    const row = journal.attempts.find(entry => entry.ticket.id === ticket.id)
    if (!row || JSON.stringify(row.ticket) !== JSON.stringify(ticket) || ticket.estimate.accountingOwner !== "native") throw new Error("Native preparation ticket mismatch")
    const raw = await ctx.storage.read(`.scispark/tool-runs/${ticket.runId}/native-financial-links/${ticket.step.id}.json`)
    const link = raw ? NativeFinancialLinkSchema.parse(JSON.parse(raw)) : null
    if (!link || link.id !== ticket.step.id || link.dispatchState !== "prepared") throw new Error("Native dispatch is not proven absent")
    if (row.state === "known") throw new Error("A charged native attempt cannot be released")
    row.state = "not_dispatched"
    await persist(ctx, run, journal)
  })
}

export async function extendAllowance(ctx: WorkflowContext, runId: string, operationId: string, deltaInput: Partial<RunAllowance>): Promise<ToolRun> {
  UuidSchema.parse(operationId); UuidSchema.parse(runId)
  const delta = RunAllowanceSchema.partial().parse(deltaInput)
  if (!Object.keys(delta).length || Object.values(delta).some((value) => value === null || value <= 0)) throw new Error("Allowance extensions require positive deltas")
  return withVaultExclusive(ctx.storage, `workflow-${runId}`, async () => {
    const { run, journal } = await state(ctx, runId)
    const lifecycleRaw = await ctx.storage.read(`.scispark/tool-runs/${runId}/journal.json`)
    if (lifecycleRaw !== null && WorkflowJournalSchema.parse(JSON.parse(lifecycleRaw)).actions.some(a => a.operationId === operationId)) throw new Error("Workflow action operation conflict")
    const previous = journal.extensions.find((entry) => entry.operationId === operationId)
    if (previous) {
      if (JSON.stringify(previous.delta) !== JSON.stringify(delta)) throw new Error("Allowance operation identity conflict")
    } else {
      for (const key of Object.keys(delta) as Array<keyof RunAllowance>) {
        if (journal.allowance[key] === null) throw new Error("Cannot extend a null cost allowance")
        journal.allowance[key]! += delta[key]!
      }
      RunAllowanceSchema.parse(journal.allowance)
      journal.extensions.push({ operationId, delta })
    }
    return persist(ctx, run, journal)
  })
}

/** Atomically consume dispatch permission; crash/reopen never dispatches it again. */
export async function claimAttemptDispatch(ctx: WorkflowContext, input: AttemptTicket): Promise<void> {
  const ticket = AttemptTicketSchema.parse(input)
  await withVaultExclusive(ctx.storage, `workflow-${ticket.runId}`, async () => {
    const { run, journal, cancellationPending } = await state(ctx, ticket.runId)
    const row = journal.attempts.find((entry) => entry.ticket.id === ticket.id)
    if (!row || JSON.stringify(row.ticket) !== JSON.stringify(ticket) || row.state !== "reserved" || row.dispatchedAt) throw new Error("Attempt already dispatched or requires reconciliation")
    // Authorization can change after reservation (including an idempotent
    // readback), so recheck it under the lock that consumes dispatch permission.
    if (cancellationPending) throw new Error("Workflow cancellation is pending")
    if (["completed", "failed", "cancelled"].includes(run.status)) throw new Error("Workflow run is terminal")
    if (!["queued", "running"].includes(run.status)) throw new Error("Workflow is paused or requires user action")
    row.dispatchedAt = new Date().toISOString()
    await persist(ctx, run, journal)
  })
}

/** Pure journal projection for HTTP observers; no lock files or mirror repair. */
export async function projectRunUsage(ctx: WorkflowContext, id: string): Promise<Pick<ToolRun, "usage" | "allowance">> {
  const { run, journal } = await state(ctx, id)
  const usage = totals(journal, run.model.engine !== "api")
  return { allowance: journal.allowance, usage: { modelCalls: usage.modelCalls, commandCalls: usage.commandCalls, activeSeconds: usage.activeSeconds, costUsd: usage.costUsd } }
}
