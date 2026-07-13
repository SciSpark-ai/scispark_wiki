import { describe, it, expect } from "vitest"
import { OpenAICompatProvider, openAIProvider, openRouterProvider } from "../providers/openai-compat"
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

const OK_RESPONSE = {
  id: "chatcmpl-123",
  object: "chat.completion",
  created: 1234567890,
  model: "gpt-4o",
  choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
}

describe("OpenAICompatProvider", () => {
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

    expect(result.text).toBe("hello")
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(result.provider).toBe("openai")
    expect(result.model).toBe("gpt-4o")
    expect(result.stopReason).toBe("stop")
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
