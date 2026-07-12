import { describe, it, expect } from "vitest"
import { estimateCostUsd } from "../pricing"

describe("estimateCostUsd", () => {
  it("computes from per-million rates", () => {
    // claude-haiku-4-5: $1/M in, $5/M out
    expect(estimateCostUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 200_000 }))
      .toBeCloseTo(1 + 1, 6)
  })
  it("returns null for unknown models", () => {
    expect(estimateCostUsd("mystery-model", { inputTokens: 10, outputTokens: 10 })).toBeNull()
  })
  it("matches prefixed model ids (openrouter routes like anthropic/claude-haiku-4-5)", () => {
    expect(estimateCostUsd("anthropic/claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0 }))
      .toBeCloseTo(1, 6)
  })
  it("computes OpenAI rates (gpt-5.4-mini: $0.75/M in, $4.50/M out)", () => {
    expect(estimateCostUsd("gpt-5.4-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 }))
      .toBeCloseTo(0.75 + 4.5, 6)
  })
  it("computes Google rates (gemini-3.5-flash: $1.50/M in, $9.00/M out)", () => {
    expect(estimateCostUsd("gemini-3.5-flash", { inputTokens: 1_000_000, outputTokens: 1_000_000 }))
      .toBeCloseTo(1.5 + 9, 6)
  })
})
