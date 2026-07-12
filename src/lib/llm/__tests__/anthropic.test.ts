import { describe, it, expect } from "vitest"
import { AnthropicProvider } from "../providers/anthropic"
import { LLMAuthError, LLMRateLimitError, LLMTransientError } from "../types"

function fakeFetch(status: number, body: unknown, responseHeaders?: Record<string, string>): { fn: typeof fetch; captured: { url?: string; init?: RequestInit } } {
  const captured: { url?: string; init?: RequestInit } = {}
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured.url = String(url)
    captured.init = init
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...responseHeaders },
    })
  }) as typeof fetch
  return { fn, captured }
}

const OK_MESSAGE = {
  id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5",
  content: [{ type: "text", text: "hello" }],
  stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
}

describe("AnthropicProvider", () => {
  it("sends a Messages API request and maps the result", async () => {
    const { fn, captured } = fakeFetch(200, OK_MESSAGE)
    const p = new AnthropicProvider("sk-test", fn)
    const result = await p.complete("claude-haiku-4-5", {
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
    })
    expect(captured.url).toContain("/v1/messages")
    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.model).toBe("claude-haiku-4-5")
    expect(sent.system).toBe("be brief")                      // system extracted from messages
    expect(sent.messages).toEqual([{ role: "user", content: "hi" }])
    expect(result.text).toBe("hello")
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(result.provider).toBe("anthropic")
  })

  it("maps 401 to LLMAuthError", async () => {
    const { fn } = fakeFetch(401, { type: "error", error: { type: "authentication_error", message: "bad key" } })
    const p = new AnthropicProvider("sk-bad", fn)
    await expect(p.complete("claude-haiku-4-5", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMAuthError)
  })

  it("passes jsonSchema through output_config and parses json", async () => {
    const { fn, captured } = fakeFetch(200, {
      ...OK_MESSAGE,
      content: [{ type: "text", text: '{"a":1}' }],
    })
    const p = new AnthropicProvider("sk-test", fn)
    const result = await p.complete("claude-haiku-4-5", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
    })
    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.output_config?.format?.type).toBe("json_schema")
    expect(result.json).toEqual({ a: 1 })
  })

  it("maps 429 with retry-after header to LLMRateLimitError with retryAfterMs", async () => {
    const { fn } = fakeFetch(429, { type: "error", error: { type: "rate_limit_error", message: "rate limited" } }, { "retry-after": "3" })
    const p = new AnthropicProvider("sk-test", fn)
    await expect(p.complete("claude-haiku-4-5", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMRateLimitError)
    try {
      await p.complete("claude-haiku-4-5", { messages: [{ role: "user", content: "hi" }] })
    } catch (e) {
      expect(e).toBeInstanceOf(LLMRateLimitError)
      expect((e as LLMRateLimitError).retryAfterMs).toBe(3000)
    }
  })

  it("maps 429 without retry-after header to LLMRateLimitError with undefined retryAfterMs", async () => {
    const { fn } = fakeFetch(429, { type: "error", error: { type: "rate_limit_error", message: "rate limited" } })
    const p = new AnthropicProvider("sk-test", fn)
    try {
      await p.complete("claude-haiku-4-5", { messages: [{ role: "user", content: "hi" }] })
    } catch (e) {
      expect(e).toBeInstanceOf(LLMRateLimitError)
      expect((e as LLMRateLimitError).retryAfterMs).toBeUndefined()
    }
  })

  it("maps 500 to LLMTransientError", async () => {
    const { fn } = fakeFetch(500, { type: "error", error: { type: "internal_server_error", message: "server error" } })
    const p = new AnthropicProvider("sk-test", fn)
    await expect(p.complete("claude-haiku-4-5", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMTransientError)
  })
})
