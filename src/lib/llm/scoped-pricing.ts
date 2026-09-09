import { z } from "zod"
import type { LLMUsage, ProviderId } from "./types"

export const TokenRatesSchema = z.object({
  inputPerMillion: z.number().finite().nonnegative(),
  outputPerMillion: z.number().finite().nonnegative(),
  cachedInputPerMillion: z.number().finite().nonnegative().optional(),
}).strict()
export type TokenRates = z.infer<typeof TokenRatesSchema>

/** A user quote belongs to this endpoint/model, not every identically named model. */
export const ScopedPriceSchema = z.object({
  provider: z.enum(["openai", "openrouter", "anthropic", "google"]),
  baseUrl: z.url(),
  model: z.string().min(1),
  rates: TokenRatesSchema,
  provenance: z.string().min(1),
  recordedAt: z.iso.datetime(),
}).strict()
export type ScopedPrice = z.infer<typeof ScopedPriceSchema>

export function matchesPrice(price: ScopedPrice, target: { provider: ProviderId; baseUrl: string; model: string }): boolean {
  return price.provider === target.provider && price.model === target.model
    && price.baseUrl.replace(/\/+$/, "") === target.baseUrl.replace(/\/+$/, "")
}

const count = (n: number) => Number.isSafeInteger(n) && n >= 0

/** Unknown or inconsistent usage stays unknown. Reasoning is already in output. */
export function priceTokenUsage(usage: LLMUsage, rates: TokenRates): number | null {
  if (!TokenRatesSchema.safeParse(rates).success || usage.reported === false
    || !count(usage.inputTokens) || !count(usage.outputTokens)) return null
  const cached = usage.cachedInputTokens ?? 0
  if (!count(cached) || cached > usage.inputTokens) return null
  if (usage.reasoningTokens !== undefined && (!count(usage.reasoningTokens) || usage.reasoningTokens > usage.outputTokens)) return null
  return ((usage.inputTokens - cached) * rates.inputPerMillion
    + cached * (rates.cachedInputPerMillion ?? rates.inputPerMillion)
    + usage.outputTokens * rates.outputPerMillion) / 1e6
}

/** No speculative cache savings. Caller supplies a conservative input ceiling. */
export function reserveTokenCost(inputCeiling: number, outputCeiling: number, rates: TokenRates): number {
  const cost = priceTokenUsage({ inputTokens: inputCeiling, outputTokens: outputCeiling }, rates)
  if (cost === null) throw new Error("Cannot reserve an unpriced or invalid token allowance")
  return cost
}
