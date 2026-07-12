import { describe, it, expect } from "vitest"
import { LLMError, LLMAuthError, LLMRateLimitError, LLMTransientError, isRetryable } from "../types"

describe("llm errors", () => {
  it("classifies retryability", () => {
    expect(isRetryable(new LLMTransientError("overloaded"))).toBe(true)
    expect(isRetryable(new LLMRateLimitError("slow down"))).toBe(true)
    expect(isRetryable(new LLMAuthError("bad key"))).toBe(false)
    expect(isRetryable(new Error("random"))).toBe(false)
  })
  it("error hierarchy", () => {
    expect(new LLMAuthError("x")).toBeInstanceOf(LLMError)
    const rl = new LLMRateLimitError("x", 3000)
    expect(rl.retryAfterMs).toBe(3000)
  })
})
