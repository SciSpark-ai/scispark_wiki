import { describe, it, expect } from "vitest"
import { GoogleProvider } from "../providers/google"
import { LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMTransientError } from "../types"

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
  candidates: [
    {
      content: { role: "model", parts: [{ text: "hello" }] },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  modelVersion: "gemini-test",
}

describe("GoogleProvider", () => {
  it("sends a generateContent request with x-goog-api-key auth, systemInstruction, and role mapping", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = new GoogleProvider("key-test", fn)
    const result = await p.complete("gemini-test", {
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "sure" },
      ],
    })

    expect(captured.url).toContain("models/gemini-test:generateContent")
    const headers = captured.init?.headers as Record<string, string>
    expect(headers["x-goog-api-key"]).toBe("key-test")

    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.systemInstruction).toEqual({ parts: [{ text: "be brief" }] })
    expect(sent.contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "sure" }] },
    ]) // assistant -> model role mapping

    expect(result.text).toBe("hello")
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(result.provider).toBe("google")
    expect(result.stopReason).toBe("STOP")
  })

  it("joins multiple text parts from candidates[0].content.parts", async () => {
    const { fn } = fakeFetch(200, {
      ...OK_RESPONSE,
      candidates: [
        {
          content: { role: "model", parts: [{ text: "hello " }, { text: "world" }] },
          finishReason: "STOP",
        },
      ],
    })
    const p = new GoogleProvider("key-test", fn)
    const result = await p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] })
    expect(result.text).toBe("hello world")
  })

  it("defaults stopReason to 'unknown' when finishReason is missing", async () => {
    const { fn } = fakeFetch(200, {
      candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    })
    const p = new GoogleProvider("key-test", fn)
    const result = await p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] })
    expect(result.stopReason).toBe("unknown")
  })

  it("gracefully defaults on a malformed 200 response (no candidates)", async () => {
    const { fn } = fakeFetch(200, {})
    const p = new GoogleProvider("key-test", fn)
    const result = await p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] })
    expect(result.text).toBe("")
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(result.stopReason).toBe("unknown")
  })

  it("maps usage from usageMetadata.promptTokenCount/candidatesTokenCount", async () => {
    const { fn } = fakeFetch(200, { ...OK_RESPONSE, usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7, totalTokenCount: 49 } })
    const p = new GoogleProvider("key-test", fn)
    const result = await p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] })
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 })
  })

  it("sends generationConfig.maxOutputTokens when maxTokens is set", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = new GoogleProvider("key-test", fn)
    await p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }], maxTokens: 2048 })
    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.generationConfig.maxOutputTokens).toBe(2048)
  })

  it("sends responseMimeType/responseSchema for jsonSchema and strips unsupported keywords (additionalProperties), and parses json", async () => {
    const { fn, captured } = fakeFetch(200, {
      ...OK_RESPONSE,
      candidates: [{ content: { role: "model", parts: [{ text: '{"a":1}' }] }, finishReason: "STOP" }],
    })
    const p = new GoogleProvider("key-test", fn)
    const result = await p.complete("gemini-test", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: {
        type: "object",
        properties: { a: { type: "number" } },
        required: ["a"],
        additionalProperties: false,
      },
    })

    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.generationConfig.responseMimeType).toBe("application/json")
    expect(sent.generationConfig.responseSchema).toEqual({
      type: "object",
      properties: { a: { type: "number" } },
      required: ["a"],
    }) // additionalProperties stripped — unsupported in Gemini's Schema dialect (subset of OpenAPI 3.0)
    expect(sent.generationConfig.responseSchema.additionalProperties).toBeUndefined()
    expect(result.json).toEqual({ a: 1 })
  })

  it("strips additionalProperties recursively from nested schemas", async () => {
    const { fn, captured } = fakeFetch(200, OK_RESPONSE)
    const p = new GoogleProvider("key-test", fn)
    await p.complete("gemini-test", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "object", properties: { b: { type: "string" } }, additionalProperties: false },
          },
        },
        additionalProperties: false,
      },
    })
    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.generationConfig.responseSchema.additionalProperties).toBeUndefined()
    expect(sent.generationConfig.responseSchema.properties.items.items.additionalProperties).toBeUndefined()
  })

  it("maps 401 to LLMAuthError", async () => {
    const { fn } = fakeFetch(401, { error: { code: 401, message: "bad key", status: "UNAUTHENTICATED" } })
    const p = new GoogleProvider("key-bad", fn)
    await expect(p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMAuthError)
  })

  it("maps 403 to LLMAuthError", async () => {
    const { fn } = fakeFetch(403, { error: { code: 403, message: "forbidden", status: "PERMISSION_DENIED" } })
    const p = new GoogleProvider("key-bad", fn)
    await expect(p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMAuthError)
  })

  it("maps 429 with retry-after header to LLMRateLimitError with retryAfterMs", async () => {
    const { fn } = fakeFetch(429, { error: { code: 429, message: "rate limited" } }, { "retry-after": "2" })
    const p = new GoogleProvider("key-test", fn)
    try {
      await p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] })
      throw new Error("expected rejection")
    } catch (e) {
      expect(e).toBeInstanceOf(LLMRateLimitError)
      expect((e as LLMRateLimitError).retryAfterMs).toBe(2000)
    }
  })

  it("maps 429 without retry-after header to LLMRateLimitError with undefined retryAfterMs", async () => {
    const { fn } = fakeFetch(429, { error: { code: 429, message: "rate limited" } })
    const p = new GoogleProvider("key-test", fn)
    try {
      await p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] })
      throw new Error("expected rejection")
    } catch (e) {
      expect(e).toBeInstanceOf(LLMRateLimitError)
      expect((e as LLMRateLimitError).retryAfterMs).toBeUndefined()
    }
  })

  it("maps 500 to LLMTransientError", async () => {
    const { fn } = fakeFetch(500, { error: { code: 500, message: "server error" } })
    const p = new GoogleProvider("key-test", fn)
    await expect(p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMTransientError)
  })

  it("maps other 4xx to LLMBadRequestError", async () => {
    const { fn } = fakeFetch(400, { error: { code: 400, message: "bad request" } })
    const p = new GoogleProvider("key-test", fn)
    await expect(p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMBadRequestError)
  })

  it("maps network errors to LLMTransientError", async () => {
    const fn = (async () => { throw new Error("network down") }) as typeof fetch
    const p = new GoogleProvider("key-test", fn)
    await expect(p.complete("gemini-test", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMTransientError)
  })

  it("has id 'google'", () => {
    const p = new GoogleProvider("key-test")
    expect(p.id).toBe("google")
  })
})
