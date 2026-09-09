import { describe, expect, it } from "vitest"
import { matchesPrice, priceTokenUsage, reserveTokenCost, type ScopedPrice } from "../scoped-pricing"

const rates = { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075 }
describe("endpoint-scoped user pricing", () => {
  it("prices cached input once and does not add reasoning twice", () => {
    expect(priceTokenUsage({ inputTokens: 1_000_000, cachedInputTokens: 800_000,
      outputTokens: 100_000, reasoningTokens: 80_000 }, rates)).toBeCloseTo(0.15 + 0.06 + 0.375)
    expect(reserveTokenCost(1_000_000, 100_000, rates)).toBeCloseTo(0.75 + 0.375)
  })
  it("does not transfer the price to another provider, endpoint or model", () => {
    const price: ScopedPrice = { provider: "openai", model: "google/gemini-3.8-flash",
      baseUrl: "https://api.gmi-serving.com/v1", rates, provenance: "user", recordedAt: "2026-09-07T00:00:00Z" }
    expect(matchesPrice(price, { ...price, baseUrl: `${price.baseUrl}/` })).toBe(true)
    expect(matchesPrice(price, { ...price, baseUrl: "https://api.openai.com/v1" })).toBe(false)
    expect(matchesPrice(price, { ...price, provider: "google" })).toBe(false)
    expect(matchesPrice(price, { ...price, model: "gemini-3.8-flash" })).toBe(false)
  })
  it("keeps missing and malformed usage unknown", () => {
    expect(priceTokenUsage({ inputTokens: 0, outputTokens: 0, reported: false }, rates)).toBeNull()
    for (const cachedInputTokens of [-1, 11, NaN, 0.5]) {
      expect(priceTokenUsage({ inputTokens: 10, outputTokens: 5, cachedInputTokens }, rates)).toBeNull()
    }
    expect(priceTokenUsage({ inputTokens: 10, outputTokens: 5, reasoningTokens: 6 }, rates)).toBeNull()
    expect(priceTokenUsage({ inputTokens: 10, outputTokens: 5 }, { ...rates, inputPerMillion: -1 })).toBeNull()
  })
  it("assumes full input price when cache usage or its rate is unavailable", () => {
    expect(priceTokenUsage({ inputTokens: 1_000_000, outputTokens: 0 }, rates)).toBe(0.75)
    expect(priceTokenUsage({ inputTokens: 1_000_000, cachedInputTokens: 100_000, outputTokens: 0 },
      { inputPerMillion: 0.75, outputPerMillion: 3.75 })).toBe(0.75)
  })
})
