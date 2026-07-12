import { describe, it, expect } from "vitest"
import { withRetry } from "../retry"
import { MockProvider } from "../mock-provider"
import { LLMTransientError, LLMAuthError, type LLMResult } from "../types"

const ok = (text: string): LLMResult => ({
  text, usage: { inputTokens: 1, outputTokens: 1 },
  model: "m", provider: "anthropic", stopReason: "end_turn",
})

describe("withRetry", () => {
  it("retries transient errors then succeeds", async () => {
    const p = new MockProvider([new LLMTransientError("overloaded"), ok("hi")])
    const sleeps: number[] = []
    const result = await withRetry(() => p.complete("m", { messages: [] }), {
      sleep: async (ms) => { sleeps.push(ms) },
    })
    expect(result.text).toBe("hi")
    expect(sleeps).toHaveLength(1)
  })
  it("does not retry auth errors", async () => {
    const p = new MockProvider([new LLMAuthError("bad key"), ok("never")])
    await expect(withRetry(() => p.complete("m", { messages: [] }), { sleep: async () => {} }))
      .rejects.toThrow(LLMAuthError)
    expect(p.calls).toHaveLength(1)
  })
  it("gives up after retries and rethrows", async () => {
    const p = new MockProvider([
      new LLMTransientError("1"), new LLMTransientError("2"), new LLMTransientError("3"),
    ])
    await expect(withRetry(() => p.complete("m", { messages: [] }), { retries: 2, sleep: async () => {} }))
      .rejects.toThrow("3")
  })
})
