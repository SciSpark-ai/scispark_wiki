import { withVaultExclusive } from "../vault/exclusive"
import { z } from "zod"
import { Meter, checkBudget } from "../llm/metering"
import { writeNativeReservation } from "../llm/native-reservations"
import { createHash } from "node:crypto"
import type { LLMProvider, LLMRequest, LLMResult, Tier } from "../llm/types"
import { loadSettings, type LLMSettings } from "../llm/settings"
import { matchesPrice, priceTokenUsage, reserveTokenCost } from "../llm/scoped-pricing"
import type { VaultStorage } from "../vault/storage"
import { currentRunAttemptScope, withWorkflowAttempt } from "./attempt-scope"
import { modelEndpoint, settingsForRunModel } from "./model"
import { readRun } from "./store"
import { getRunUsage } from "./usage"


export const NativeFinancialLinkSchema = z.object({ id: z.string().uuid(), ledger: z.enum(["review", "local-review", "meter"]), nativeRunId: z.string().regex(/^review_[a-f0-9]{32}$/).optional(), dispatchState: z.enum(["prepared", "dispatching"]).default("dispatching") }).strict()

export async function nativeSettings(storage: VaultStorage, fallback?: LLMSettings, tier: Tier = "strong"): Promise<LLMSettings> {
  const scope = currentRunAttemptScope()
  if (!scope) return fallback ?? loadSettings(storage)
  const run = await readRun(scope.ctx, scope.runId)
  if (!run) throw new Error("Workflow run not found")
  return settingsForRunModel(scope.ctx, run.model, tier)
}
/** Called INSIDE the existing native spending lock, once per raw dispatch.
 * The native callback persists its own financial row before returning. This
 * wrapper does not reacquire the caller lock or record a second Meter charge.
 * Subscription callers hold local-engine; brief journal writes take ai-spend. */
export async function nativeAttempt(provider: LLMProvider, model: string, request: LLMRequest,
  ledger: "review" | "local-review" | "meter", id: string,
  work: (request: LLMRequest, cost: (result: LLMResult) => number | null, day: string, enterDispatch: () => Promise<void>) => Promise<LLMResult>,
  tier: Tier = "strong", rates?: { inputPerMillion: number; outputPerMillion: number }, nativeRunId?: string): Promise<LLMResult> {
  const scope = currentRunAttemptScope()
  if (!scope) return work(request, result => rates ? priceTokenUsage(result.usage, rates) : null, new Date().toISOString().slice(0, 10), async () => {})
  const run = await readRun(scope.ctx, scope.runId)
  if (!run) throw new Error("Workflow run not found")
  const selection = run.model.tierModels[tier], subscription = run.model.engine !== "api"
  if (model !== selection.model || provider.id !== selection.provider || (provider.billingMode === "subscription") !== subscription) throw new Error("Native provider does not match the captured model")
  const quote = run.model.scopedPrices?.[tier]
  if (!subscription && !rates && (!quote || !matchesPrice(quote, { ...selection, baseUrl: modelEndpoint(selection) }))) throw new Error("Configure pricing for the captured native model")
  const prices = rates ?? quote?.rates
  const cost = (result: LLMResult) => subscription ? null : priceTokenUsage(result.usage, prices!)
  const used = await getRunUsage(scope.ctx, scope.runId)
  const activeSeconds = Math.min(run.model.timeoutSeconds ?? 180, run.allowance.activeSeconds - used.activeSeconds - used.heldActiveSeconds)
  const inputHash = createHash("sha256").update(JSON.stringify({ model, messages: request.messages, jsonSchema: request.jsonSchema })).digest("hex")
  const reservedUsd = subscription ? null : reserveTokenCost(Buffer.byteLength(JSON.stringify({ ...request, signal: undefined }), "utf8") + 4096, request.maxTokens ?? 4096, prices!)
  if (ledger === "meter" && !subscription) await checkBudget(new Meter(scope.ctx.storage), await nativeSettings(scope.ctx.storage, undefined, tier), reservedUsd!)
  // This proof precedes the root reservation. A failed preparation publication
  // can never strand a root hold with no native reference. Old links default to
  // dispatching, so missing history is never interpreted as a refund authority.
  const link = NativeFinancialLinkSchema.parse({ id, ledger, nativeRunId, dispatchState: "prepared" })
  const linkPath = `.scispark/tool-runs/${scope.runId}/native-financial-links/${id}.json`
  if (await scope.ctx.storage.read(linkPath)) throw new Error("Native attempt identity already published")
  await scope.ctx.storage.write(linkPath, JSON.stringify(link))
  return withWorkflowAttempt(scope.ctx, scope.runId, { id, kind: "model", replay: "reconcile", inputHash }, {
    modelCalls: 1, commandCalls: 0, activeSeconds: Math.max(0, activeSeconds),
    costUsd: reservedUsd, accountingOwner: "native",
  }, async (signal, ticket) => {
    const reservation = { id, runId: scope.runId, day: ticket.reservedAt.slice(0, 10), billingMode: subscription ? "subscription" as const : "api" as const, reservedUsd, costUsd: null as number | null, state: "reserved" as const }
    const recordReservation = (row: Parameters<typeof writeNativeReservation>[1]) => subscription
      ? withVaultExclusive(scope.ctx.storage, "ai-spend", () => writeNativeReservation(scope.ctx.storage, row))
      : writeNativeReservation(scope.ctx.storage, row)
    signal.throwIfAborted()
    if (ledger === "meter") await recordReservation(reservation)
    // The persisted transition, not whether write() returned successfully,
    // determines ambiguity after a crash or committed-then-threw storage fault.
    const enterDispatch = async () => {
      signal.throwIfAborted()
      await scope.ctx.storage.write(linkPath, JSON.stringify({ ...link, dispatchState: "dispatching" }))
      signal.throwIfAborted()
    }
    const value = await work({ ...request, singleAttempt: true, signal: request.signal ? AbortSignal.any([request.signal, signal]) : signal }, cost, reservation.day, enterDispatch)
    if (ledger === "meter") await recordReservation({ ...reservation, costUsd: cost(value), state: subscription || cost(value) !== null ? "settled" : "reserved" })
    return { value, result: { modelCalls: 1, commandCalls: 0, activeSeconds: 0, costUsd: cost(value),
      outcome: subscription || cost(value) !== null ? "known" : "unknown", usage: value.usage, financialLedgerRef: { ledger, attemptId: id } } }
  }, request.signal)
}
