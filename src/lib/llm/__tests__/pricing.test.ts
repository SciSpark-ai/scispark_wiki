import { describe, it, expect } from "vitest"
import { estimateCostUsd, estimateNextCallUsd } from "../pricing"

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

describe("estimateNextCallUsd", () => {
  it("prices prompt chars/4 as input tokens + explicit maxTokens as output, against a known PRICES entry", () => {
    // claude-haiku-4-5: $1/M in, $5/M out. 4000 chars -> 1000 input tokens.
    const req = { messages: [{ content: "a".repeat(4000) }], maxTokens: 500 }
    // input: 1000/1e6 * 1 = 0.001; output: 500/1e6 * 5 = 0.0025
    expect(estimateNextCallUsd("claude-haiku-4-5", req)).toBeCloseTo(0.001 + 0.0025, 6)
  })

  it("sums chars across all messages before dividing by 4", () => {
    const req = {
      messages: [{ content: "a".repeat(2000) }, { content: "b".repeat(2000) }],
      maxTokens: 500,
    }
    expect(estimateNextCallUsd("claude-haiku-4-5", req)).toBeCloseTo(0.001 + 0.0025, 6)
  })

  it("defaults maxTokens to 1024 when omitted", () => {
    const req = { messages: [{ content: "" }] }
    // input: 0 tokens; output: 1024/1e6 * 5 = 0.00512
    expect(estimateNextCallUsd("claude-haiku-4-5", req)).toBeCloseTo(0.00512, 6)
  })

  it("returns null for unknown models", () => {
    const req = { messages: [{ content: "hello" }], maxTokens: 100 }
    expect(estimateNextCallUsd("mystery-model", req)).toBeNull()
  })

  it("matches prefixed model ids (openrouter routes like anthropic/claude-haiku-4-5)", () => {
    const req = { messages: [{ content: "a".repeat(4000) }], maxTokens: 500 }
    expect(estimateNextCallUsd("anthropic/claude-haiku-4-5", req)).toBeCloseTo(0.001 + 0.0025, 6)
  })
})
