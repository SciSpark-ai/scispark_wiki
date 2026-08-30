import { describe, it, expect, beforeEach } from "vitest"
import { OpenAICompatProvider, openAIProvider, openRouterProvider, isStructuredOutputRejection, getFallbackStats, resetFallbackStats } from "../providers/openai-compat"
import { LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMTransientError } from "../types"

/** A fetch stub that returns a scripted response per call, capturing each request body.
 * Used to exercise the GMI-flake prompt-JSON fallback (first call 400s, second 200s). */
function sequencedFetch(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
): { fn: typeof fetch; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = []
  let i = 0
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...r.headers },
    })
  }) as typeof fetch
  return { fn, calls }
}

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

const OK_RESPONSE = {
  id: "chatcmpl-123",
  object: "chat.completion",
  created: 1234567890,
  model: "gpt-4o",
  choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
}

describe("OpenAICompatProvider", () => {
  beforeEach(() => {
    resetFallbackStats()
  })

  it("sends a chat/completions request with bearer auth and system in-array, and maps the result", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    const result = await p.complete("gpt-4o", {
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
    })

    expect(captured.url).toBe("https://api.openai.com/v1/chat/completions")
    const headers = captured.init?.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer sk-test")

    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.model).toBe("gpt-4o")
    expect(sent.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]) // system stays in-array for this API
    expect(sent).not.toHaveProperty("chat_template_kwargs")

    expect(result.text).toBe("hello")
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(result.provider).toBe("openai")
    expect(result.model).toBe("gpt-4o")
    expect(result.stopReason).toBe("stop")
  })

  it("sends Qwen3.8's documented hard non-thinking controls when the request disables thinking", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.gmi-serving.com/v1", fn)

    await p.complete("Qwen/Qwen3.8-27B", {
      messages: [{ role: "user", content: "return JSON" }],
      thinking: "disabled",
      jsonSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    })

    const sent = JSON.parse(String(captured.init?.body))
    expect(sent).toMatchObject({
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      presence_penalty: 1.5,
      chat_template_kwargs: { enable_thinking: false },
    })
    expect(sent.response_format.type).toBe("json_schema")
  })

  it("does not send Qwen-only controls to other models even when thinking is disabled", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)

    await p.complete("gpt-4o", {
      messages: [{ role: "user", content: "return JSON" }],
      thinking: "disabled",
    })

    const sent = JSON.parse(String(captured.init?.body))
    expect(sent).not.toHaveProperty("chat_template_kwargs")
    expect(sent).not.toHaveProperty("top_k")
    expect(sent).not.toHaveProperty("presence_penalty")
  })

  it("sends Qwen's documented medium thinking controls when requested", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.gmi-serving.com/v1", fn)

    await p.complete("Qwen/Qwen3.8-27B", {
      messages: [{ role: "user", content: "analyze this paper" }],
      thinking: "enabled",
      reasoningEffort: "medium",
    })

    const sent = JSON.parse(String(captured.init?.body))
    expect(sent).toMatchObject({
      temperature: 1,
      top_p: 0.95,
      top_k: 20,
      presence_penalty: 0,
      reasoning_effort: "medium",
      chat_template_kwargs: { enable_thinking: true },
    })
  })

  it("aborts and throws a transient 'timed out' error when the request exceeds timeoutMs (a hung provider never blocks forever)", async () => {
    // A fetch that never resolves on its own — it only settles when the
    // provider's timeout fires controller.abort() (mirrors a hung GMI response).
    const hangingFetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal) signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      })) as typeof fetch

    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", hangingFetch, 10)
    await expect(p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      LLMTransientError,
    )
    await expect(
      p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/timed out/)
  })

  it("sends response_format json_schema shape with strict:false and strips top-level $schema, when jsonSchema is set", async () => {
    const { fn, captured } = fakeFetch(200, {
      ...OK_RESPONSE,
      choices: [{ index: 0, message: { role: "assistant", content: '{"a":1}' }, finish_reason: "stop" }],
    })
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    const result = await p.complete("gpt-4o", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { a: { type: "number" } },
        required: ["a"],
        additionalProperties: false,
      },
      schemaName: "extraction",
    })

    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "extraction",
        strict: false,
        schema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
      },
    })
    expect(sent.response_format.json_schema.schema).not.toHaveProperty("$schema")
    expect(result.json).toEqual({ a: 1 })
  })

  it("strips constraint keywords (minItems/maximum/etc.) recursively from the wire schema, but never property NAMES", async () => {
    const { fn, captured } = fakeFetch(200, {
      ...OK_RESPONSE,
      choices: [{ index: 0, message: { role: "assistant", content: '{"queries":[]}' }, finish_reason: "stop" }],
    })
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    await p.complete("gpt-4o", {
      messages: [{ role: "user", content: "x" }],
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          queries: {
            minItems: 1,
            maxItems: 8,
            type: "array",
            items: {
              type: "object",
              properties: {
                score: { type: "number", minimum: 0, maximum: 100 },
                // A property legitimately NAMED like a constraint keyword must survive.
                pattern: { type: "string", minLength: 2 },
              },
              required: ["score", "pattern"],
              additionalProperties: false,
            },
          },
        },
        required: ["queries"],
        additionalProperties: false,
      },
      schemaName: "result",
    })

    const sent = JSON.parse(String(captured.init?.body))
    const wire = sent.response_format.json_schema.schema
    expect(wire.properties.queries).not.toHaveProperty("minItems")
    expect(wire.properties.queries).not.toHaveProperty("maxItems")
    const item = wire.properties.queries.items
    expect(item.properties.score).toEqual({ type: "number" })
    // Property named "pattern" survives; its own constraint keyword is stripped.
    expect(item.properties.pattern).toEqual({ type: "string" })
    expect(item.required).toEqual(["score", "pattern"])
    expect(item.additionalProperties).toBe(false)
  })

  it("maps usage from prompt_tokens/completion_tokens", async () => {
    const { fn } = fakeFetch(200, { ...OK_RESPONSE, usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } })
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    const result = await p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] })
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 })
  })

  it("maps 401 to LLMAuthError", async () => {
    const { fn } = fakeFetch(401, { error: { message: "bad key", type: "invalid_request_error" } })
    const p = new OpenAICompatProvider("openai", "sk-bad", "https://api.openai.com/v1", fn)
    await expect(p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMAuthError)
  })

  it("maps 429 with retry-after header to LLMRateLimitError with retryAfterMs", async () => {
    const { fn } = fakeFetch(429, { error: { message: "rate limited" } }, { "retry-after": "2" })
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    try {
      await p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] })
      throw new Error("expected rejection")
    } catch (e) {
      expect(e).toBeInstanceOf(LLMRateLimitError)
      expect((e as LLMRateLimitError).retryAfterMs).toBe(2000)
    }
  })

  it("maps 429 without retry-after header to LLMRateLimitError with undefined retryAfterMs", async () => {
    const { fn } = fakeFetch(429, { error: { message: "rate limited" } })
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    try {
      await p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] })
      throw new Error("expected rejection")
    } catch (e) {
      expect(e).toBeInstanceOf(LLMRateLimitError)
      expect((e as LLMRateLimitError).retryAfterMs).toBeUndefined()
    }
  })

  it("maps 500 to LLMTransientError", async () => {
    const { fn } = fakeFetch(500, { error: { message: "server error" } })
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    await expect(p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMTransientError)
  })

  it("openAIProvider factory targets api.openai.com with id 'openai'", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = openAIProvider("sk-test", fn)
    expect(p.id).toBe("openai")
    await p.complete("gpt-4o", { messages: [{ role: "user", content: "hi" }] })
    expect(captured.url).toBe("https://api.openai.com/v1/chat/completions")
  })

  it("GMI FLAKE FALLBACK: on an output_config.format 400, retries with prompt-embedded JSON (no response_format) and parses the result", async () => {
    const flake = {
      error: { message: "output_config.format: Extra inputs are not permitted", code: 400 },
    }
    const { fn, calls } = sequencedFetch([
      { status: 400, body: flake },
      {
        status: 200,
        body: { ...OK_RESPONSE, choices: [{ index: 0, message: { role: "assistant", content: '{"a":7}' }, finish_reason: "stop" }] },
      },
    ])
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.gmi-serving.com/v1", fn)
    const result = await p.complete("anthropic/claude-sonnet-5", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
      schemaName: "extraction",
    })

    expect(calls.length).toBe(2)
    // First attempt used native response_format...
    expect(calls[0].body).toHaveProperty("response_format")
    // ...the retry dropped response_format and appended a schema instruction as a user turn.
    expect(calls[1].body).not.toHaveProperty("response_format")
    const retryMessages = (calls[1].body as { messages: Array<{ role: string; content: string }> }).messages
    expect(retryMessages[retryMessages.length - 1].role).toBe("user")
    expect(retryMessages[retryMessages.length - 1].content).toContain("JSON Schema")
    expect(result.json).toEqual({ a: 7 })
    expect(getFallbackStats().promptJsonFallbacks).toBe(1)
  })

  it("does NOT increment fallback stats on a normal (no-fallback) structured call", async () => {
    const { fn, captured } = fakeFetch(200, {
      ...OK_RESPONSE,
      choices: [{ index: 0, message: { role: "assistant", content: '{"a":1}' }, finish_reason: "stop" }],
    })
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.openai.com/v1", fn)
    await p.complete("gpt-4o", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
      schemaName: "extraction",
    })
    expect(captured.url).toBe("https://api.openai.com/v1/chat/completions")
    expect(getFallbackStats().promptJsonFallbacks).toBe(0)
  })

  it("does NOT increment fallback stats on a genuine non-fallback 400", async () => {
    const { fn } = sequencedFetch([
      { status: 400, body: { error: { message: "context length exceeded" } } },
    ])
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.gmi-serving.com/v1", fn)
    await expect(
      p.complete("anthropic/claude-sonnet-5", {
        messages: [{ role: "user", content: "x" }],
        jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
      }),
    ).rejects.toThrow(LLMBadRequestError)
    expect(getFallbackStats().promptJsonFallbacks).toBe(0)
  })

  it("prompt-JSON fallback tolerates a fenced ```json block in the model's text", async () => {
    const { fn } = sequencedFetch([
      { status: 400, body: { error: { message: "output_config.format: Extra inputs are not permitted" } } },
      {
        status: 200,
        body: { ...OK_RESPONSE, choices: [{ index: 0, message: { role: "assistant", content: "Here you go:\n```json\n{\"a\":9}\n```" }, finish_reason: "stop" }] },
      },
    ])
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.gmi-serving.com/v1", fn)
    const result = await p.complete("anthropic/claude-sonnet-5", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
    })
    expect(result.json).toEqual({ a: 9 })
  })

  it("does NOT fall back on an unrelated 400 (a genuine bad request still throws)", async () => {
    const { fn, calls } = sequencedFetch([
      { status: 400, body: { error: { message: "context length exceeded" } } },
    ])
    const p = new OpenAICompatProvider("openai", "sk-test", "https://api.gmi-serving.com/v1", fn)
    await expect(
      p.complete("anthropic/claude-sonnet-5", {
        messages: [{ role: "user", content: "x" }],
        jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
      }),
    ).rejects.toThrow(LLMBadRequestError)
    expect(calls.length).toBe(1) // no retry
  })

  it("isStructuredOutputRejection matches the GMI flake but not unrelated 400s", () => {
    expect(isStructuredOutputRejection("output_config.format: Extra inputs are not permitted")).toBe(true)
    expect(isStructuredOutputRejection("Invalid response_format shape")).toBe(true)
    expect(isStructuredOutputRejection("context length exceeded")).toBe(false)
    expect(isStructuredOutputRejection("invalid api key")).toBe(false)
  })

  it("openRouterProvider hits openrouter.ai, has id 'openrouter', and sends HTTP-Referer/X-Title attribution headers", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = openRouterProvider("sk-test", fn)
    expect(p.id).toBe("openrouter")
    await p.complete("openai/gpt-4o", { messages: [{ role: "user", content: "hi" }] })

    expect(captured.url).toBe("https://openrouter.ai/api/v1/chat/completions")
    const headers = captured.init?.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer sk-test")
    expect(headers["HTTP-Referer"]).toBeTruthy()
    expect(headers["X-Title"]).toBeTruthy()
  })
})
