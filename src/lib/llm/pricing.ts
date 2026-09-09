import type { LLMUsage } from "./types"

/** A sum is unknown if any billed call has no known price. Zero means no cost. */
export function addCosts(...amounts: Array<number | null>): number | null {
  return amounts.some((amount) => amount === null) ? null : (amounts as number[]).reduce((sum, amount) => sum + amount, 0)
}

export function formatCost(cost: number | null | undefined, digits = 2): string {
  return cost == null ? "Cost unavailable" : `≈ $${cost.toFixed(digits)}`
}

/**
 * USD per million tokens. Verified 2026-07-12 against official pricing pages:
 * - Anthropic: https://www.anthropic.com/pricing (rates supplied pre-verified by task spec)
 * - OpenAI: https://developers.openai.com/api/docs/pricing (platform.openai.com/docs/pricing redirects here)
 * - Google: https://ai.google.dev/gemini-api/docs/pricing
 * Update alongside provider price changes.
 */
export const PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  // Anthropic
  "claude-opus-4-8": { inPerM: 5, outPerM: 25 },
  "claude-sonnet-5": { inPerM: 3, outPerM: 15 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
  // OpenAI (frontier + mini/cheap class)
  "gpt-5.6-sol": { inPerM: 5, outPerM: 30 },
  "gpt-5.4-mini": { inPerM: 0.75, outPerM: 4.5 },
  // Google Gemini (pro-class + flash-class, standard rate for prompts <=200k tokens)
  "gemini-3.1-pro-preview": { inPerM: 2, outPerM: 12 },
  "gemini-3.5-flash": { inPerM: 1.5, outPerM: 9 },
}

export function estimateCostUsd(model: string, usage: LLMUsage): number | null {
  if (usage.reported === false || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0
    || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) return null
  const key = model in PRICES ? model : model.split("/").pop() ?? model
  const p = PRICES[key]
  if (!p) return null
  return (usage.inputTokens / 1e6) * p.inPerM + (usage.outputTokens / 1e6) * p.outPerM
}

/**
 * Conservative pre-call cost projection: prompt chars/4 as input tokens + full
 * maxTokens (default 1024) as output. Unknown model → null (caller treats as 0,
 * preserving today's reactive behavior for unpriced models).
 */
export function estimateNextCallUsd(
  model: string,
  req: { messages: Array<{ content: string }>; maxTokens?: number },
): number | null {
  const chars = req.messages.reduce((sum, m) => sum + m.content.length, 0)
  const inputTokens = Math.ceil(chars / 4)
  const outputTokens = req.maxTokens ?? 1024
  return estimateCostUsd(model, { inputTokens, outputTokens })
}
