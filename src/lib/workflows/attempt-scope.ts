import { AsyncLocalStorage } from "node:async_hooks"
import { Meter } from "../llm/metering"
import { matchesPrice, priceTokenUsage, reserveTokenCost, ScopedPriceSchema, type ScopedPrice } from "../llm/scoped-pricing"
import { buildProvider } from "../llm/settings"
import type { LLMProvider, LLMRequest, LLMResult, Tier } from "../llm/types"
import { withVaultExclusive } from "../vault/exclusive"
import type { WorkflowContext } from "./context"
import type { AttemptEstimate, AttemptResult, AttemptTicket, StepIntent } from "./contracts"
import { modelEndpoint, settingsForRunModel } from "./model"
import { readRun } from "./store"
import { claimAttemptDispatch, getRunUsage, reserveAttempt, settleAttempt } from "./usage"

const scope = new AsyncLocalStorage<{ ctx: WorkflowContext; runId: string }>()
/** Native bridge hooks: supporting skills inherit the original root and owner. */
export const currentRunAttemptScope = () => scope.getStore()
export async function withRunAttemptScope<T>(ctx: WorkflowContext, runId: string, work: () => Promise<T>): Promise<T> {
  const parent = scope.getStore()
  if (parent && (parent.runId !== runId || parent.ctx.profileId !== ctx.profileId || parent.ctx.vaultId !== ctx.vaultId)) throw new Error("Supporting skills must share their root workflow and owner")
  if (!await readRun(ctx, runId)) throw new Error("Workflow run not found")
  return scope.run({ ctx, runId }, work)
}

/** Work receives an abort signal and the stable identity for any native ledger.
 * Settle before returning control. Lost responses/timeouts retain the reservation. */
export async function withWorkflowAttempt<T>(ctx: WorkflowContext, runId: string, step: StepIntent, estimate: AttemptEstimate,
  work: (signal: AbortSignal, ticket: AttemptTicket) => Promise<{ value: T; result: AttemptResult }>, signal?: AbortSignal): Promise<T> {
  const parent = scope.getStore()
  if (parent && (parent.runId !== runId || parent.ctx.profileId !== ctx.profileId || parent.ctx.vaultId !== ctx.vaultId)) throw new Error("Supporting attempts must share their root workflow and owner")
  if (signal?.aborted) throw signal.reason ?? new Error("Attempt cancelled")
  const ticket = await reserveAttempt(ctx, runId, step, estimate)
  await claimAttemptDispatch(ctx, ticket)
  const abort = new AbortController()
  const started = Date.now()
  const cancel = () => abort.abort(signal?.reason ?? new Error("Attempt cancelled"))
  signal?.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(() => abort.abort(new Error("Workflow active time limit reached")), estimate.activeSeconds * 1000)
  let onAbort: (() => void) | undefined
  let settled = false
  try {
    if (signal?.aborted) cancel()
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(abort.signal.reason)
      if (abort.signal.aborted) onAbort()
      else abort.signal.addEventListener("abort", onAbort, { once: true })
    })
    const completed = await Promise.race([stopped, abort.signal.aborted ? stopped : work(abort.signal, ticket)])
    await settleAttempt(ctx, ticket, { ...completed.result, activeSeconds: Math.max(completed.result.activeSeconds, Math.min(estimate.activeSeconds, (Date.now() - started) / 1000)) })
    settled = true
    if ((await getRunUsage(ctx, runId)).uncertain) throw new Error("Attempt outcome or spending is uncertain; reconcile before continuing")
    return completed.value
  } catch (error) {
    // If a known settlement has already committed (including a failed mirror),
    // never replace it with uncertainty or mask the originating failure.
    try { if (!settled) await settleAttempt(ctx, ticket, { modelCalls: estimate.modelCalls, commandCalls: estimate.commandCalls,
      activeSeconds: Math.min(estimate.activeSeconds, (Date.now() - started) / 1000), costUsd: null, outcome: "unknown" }) } catch { /* durable prior result remains authoritative */ }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", cancel)
    if (onAbort) abort.signal.removeEventListener("abort", onAbort)
  }
}

/** A raw completion boundary for workflow-owned billing. Each repair/fallback
 * needs a new StepIntent and reservation; the provider cannot retry internally.
 * Native adapters instead use withWorkflowAttempt with accountingOwner=native. */
export async function completeWorkflowModel(ctx: WorkflowContext, runId: string, step: StepIntent, tier: Tier, request: LLMRequest,
  options: { provider?: LLMProvider; price?: ScopedPrice; activeSeconds?: number } = {}): Promise<LLMResult> {
  const run = await readRun(ctx, runId)
  if (!run) throw new Error("Workflow run not found")
  if (step.kind !== "model") throw new Error("Model dispatch requires a model step")
  const settings = await settingsForRunModel(ctx, run.model, tier)
  const selected = run.model.tierModels[tier]
  const provider = options.provider ?? buildProvider(settings, tier)
  const subscription = run.model.engine !== "api"
  if (provider.id !== selected.provider || (provider.billingMode === "subscription") !== subscription) throw new Error("Provider does not match captured workflow model")
  const price = options.price ? ScopedPriceSchema.parse(options.price) : undefined
  if (!subscription && (!price || !matchesPrice(price, { ...selected, baseUrl: modelEndpoint(selected) }))) throw new Error("Configure pricing for the captured endpoint and model")
  await provider.preflight?.(selected.model)
  const used = await getRunUsage(ctx, runId)
  const activeSeconds = options.activeSeconds ?? Math.min(run.model.timeoutSeconds ?? 180, run.allowance.activeSeconds - used.activeSeconds - used.heldActiveSeconds)
  const costUsd = subscription ? null : reserveTokenCost(Buffer.byteLength(JSON.stringify({ ...request, signal: undefined, onText: undefined }), "utf8") + 4096, request.maxTokens ?? 4096, price!.rates)
  return withWorkflowAttempt(ctx, runId, step, { modelCalls: 1, commandCalls: 0, activeSeconds, costUsd, accountingOwner: "workflow" }, async (signal, ticket) => {
    const value = await provider.complete(selected.model, { ...request, maxTokens: request.maxTokens ?? 4096, singleAttempt: true, signal })
    const charged = subscription ? null : priceTokenUsage(value.usage, price!.rates)
    const usage = subscription ? { ...value.usage, billingMode: "subscription" as const, engine: run.model.engine as "codex" | "claude-code" } : value.usage
    await withVaultExclusive(ctx.storage, "ai-spend", async () => {
      const meter = new Meter(ctx.storage, () => new Date(ticket.reservedAt))
      if (!(await meter.recordsForDay(ticket.reservedAt.slice(0, 10))).some((record) => record.runId === ticket.id)) {
        await meter.record({ skill: "workflow", runId: ticket.id, provider: selected.provider, model: selected.model, usage }, charged)
      }
    })
    return { value, result: { modelCalls: 1, commandCalls: 0, activeSeconds: 0, costUsd: charged,
      outcome: subscription || charged !== null ? "known" : "unknown", usage, financialLedgerRef: { ledger: "meter", attemptId: ticket.id } } }
  }, request.signal)
}
