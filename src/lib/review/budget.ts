import { randomUUID, createHash } from "node:crypto"
import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import { withVaultExclusive } from "../vault/exclusive"
import { Meter } from "../llm/metering"
import { buildProvider, loadSettings } from "../llm/settings"
import { completeStructured } from "../llm/structured"
import { priceTokenUsage, reserveTokenCost } from "../llm/scoped-pricing"
import type { LLMProvider } from "../llm/types"
import type { ReviewBrief } from "./contracts"

const PATH = ".scispark/usage/review-attempts.json"
const AttemptSchema = z.object({ id: z.string(), runId: z.string(), step: z.string(), signature: z.string(),
  day: z.string(), state: z.enum(["reserved", "settled", "uncertain", "acknowledged", "overrun"]),
  reservedUsd: z.number().nonnegative(), costUsd: z.number().nonnegative().nullable(), metered: z.boolean(),
  result: z.unknown().optional(), usage: z.object({ inputTokens: z.number(), outputTokens: z.number(),
    cachedInputTokens: z.number().optional(), reasoningTokens: z.number().optional(), reported: z.boolean().optional() }).optional(),
})
type Attempt = z.infer<typeof AttemptSchema>
export const hashReviewData = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex")
async function attempts(storage: VaultStorage): Promise<Attempt[]> {
  const raw = await storage.read(PATH)
  return raw === null ? [] : z.array(AttemptSchema).parse(JSON.parse(raw))
}
export async function reviewSpend(storage: VaultStorage, runId: string) {
  const rows = (await attempts(storage)).filter((a) => a.runId === runId)
  return { spentUsd: rows.reduce((s, a) => s + (a.costUsd ?? 0), 0),
    heldUsd: rows.filter((a) => a.costUsd === null).reduce((s, a) => s + a.reservedUsd, 0),
    uncertain: rows.some((a) => a.state === "reserved" || a.state === "uncertain" || a.state === "overrun") }
}
export function reviewModel(settings: Awaited<ReturnType<typeof loadSettings>>) {
  const target = settings.tierModels.strong
  const endpoint = target.provider === "openai" ? settings.baseUrls?.openai ?? "https://api.openai.com/v1"
    : target.provider === "openrouter" ? settings.baseUrls?.openrouter ?? "https://openrouter.ai/api/v1"
    : target.provider === "google" ? "https://generativelanguage.googleapis.com" : "https://api.anthropic.com"
  return { ...target, endpoint: endpoint.replace(/\/+$/, "") }
}

/** Every raw HTTP completion (including validation retries) reserves first.
 * Result + usage are a single atomic record: a lost response pauses, never
 * silently replays. All other skill calls share ai-spend exclusion. */
export async function reviewComplete<T>(storage: VaultStorage, runId: string, brief: ReviewBrief,
  step: string, prompt: string, schema: z.ZodType<T>, tokens: number,
  guard: () => Promise<void>, providerOverride?: LLMProvider): Promise<T> {
  return withVaultExclusive(storage, "ai-spend", async () => {
    await guard()
    const settings = await loadSettings(storage)
    if (JSON.stringify(reviewModel(settings)) !== JSON.stringify({ provider: brief.model.provider, model: brief.model.model, endpoint: brief.model.endpoint })) throw new Error("Your AI model changed. Approve an updated brief before continuing.")
    if (!brief.model.rates) throw new Error("Enter the selected model's token prices before starting a budgeted review.")
    const rows = await attempts(storage)
    const meter = new Meter(storage)
    const persist = () => storage.write(PATH, JSON.stringify(rows))
    const provider = providerOverride ?? buildProvider(settings, "strong")
    const settleMeter = async (row: Attempt) => {
      if (row.costUsd === null || !row.usage || row.metered) return
      // Preserve the original charge day during recovery across UTC midnight.
      const originalMeter = new Meter(storage, () => new Date(`${row.day}T12:00:00.000Z`))
      if (!(await originalMeter.recordsForDay(row.day)).some((r) => r.runId === row.id)) {
        await originalMeter.record({ skill: "literature-review", runId: row.id, provider: provider.id, model: brief.model.model, usage: row.usage }, row.costUsd)
      }
      row.metered = true; await persist()
    }
    const guarded: LLMProvider = { id: provider.id, complete: async (model, request) => {
      await guard()
      const signature = hashReviewData({ model, request: { ...request, onText: undefined } })
      const prior = rows.find((a) => a.runId === runId && a.step === step && a.signature === signature && a.state === "settled")
      if (prior?.result !== undefined) { await settleMeter(prior); return prior.result as Awaited<ReturnType<LLMProvider["complete"]>> }
      const own = rows.filter((a) => a.runId === runId)
      if (own.some((a) => a.state === "reserved" || a.state === "uncertain" || a.state === "overrun")) throw new Error("A previous call may have been billed without a result or exceeded its estimate. Acknowledge its charge before retrying.")
      const spent = own.reduce((s, a) => s + (a.costUsd ?? a.reservedUsd), 0)
      // UTF-8 bytes + overhead is a conservative input ceiling, not chars/4.
      const reserve = reserveTokenCost(Buffer.byteLength(JSON.stringify(request), "utf8") + 4096, request.maxTokens ?? tokens, brief.model.rates!)
      const daily = await meter.spendingToday()
      const held = await meter.reviewReservationsToday()
      if (daily.unpricedCount) throw new Error("Daily spending includes unknown prices. Check billing before starting more paid review work.")
      if (spent + reserve > brief.allowanceUsd || daily.knownUsd + held + reserve >= settings.dailyBudgetUsd) throw new Error("Budget limit reached. Your partial work is saved; approve a larger allowance to continue.")
      const row: Attempt = { id: randomUUID(), runId, step, signature, day: new Date().toISOString().slice(0, 10),
        state: "reserved", reservedUsd: reserve, costUsd: null, metered: false }
      rows.push(row); await persist()
      let result: Awaited<ReturnType<LLMProvider["complete"]>>
      try { result = await provider.complete(model, request) }
      catch (e) { row.state = "uncertain"; await persist(); throw e }
      row.costUsd = priceTokenUsage(result.usage, brief.model.rates!)
      row.state = row.costUsd === null ? "uncertain" : row.costUsd > reserve ? "overrun" : "settled"
      row.usage = result.usage; row.result = result
      await persist()
      await settleMeter(row)
      if (row.costUsd === null || row.costUsd > reserve) throw new Error("Provider billing could not be bounded as expected. Review spending before continuing.")
      await guard()
      return result
    } }
    return (await completeStructured(guarded, brief.model.model, {
      messages: [{ role: "user", content: prompt }], maxTokens: tokens, thinking: "enabled", singleAttempt: true,
    }, schema)).value
  })
}

export async function acknowledgeReviewCharge(storage: VaultStorage, runId: string) {
  await withVaultExclusive(storage, "ai-spend", async () => {
    const rows = await attempts(storage)
    for (const row of rows.filter((a) => a.runId === runId && (a.state === "reserved" || a.state === "uncertain" || a.state === "overrun"))) {
      row.state = row.result !== undefined && row.costUsd !== null ? "settled" : "acknowledged"; row.costUsd ??= row.reservedUsd
      // Held in the shared daily allowance; not misrepresented as measured provider usage.
    }
    await storage.write(PATH, JSON.stringify(rows))
  })
}
