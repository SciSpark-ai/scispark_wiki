import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { OpenAICompatProvider } from "../providers/openai-compat"
import { GoogleProvider } from "../providers/google"
import { AnthropicProvider } from "../providers/anthropic"
import { completeStructured } from "../structured"
import { streamedStringField } from "../streamed-field"
import type { LLMProvider } from "../types"

function sse(events: unknown[]) {
  const text = events.map((e) => `${e && typeof e === "object" && "type" in e ? `event: ${e.type}\r\n` : ""}data: ${typeof e === "string" ? e : JSON.stringify(e)}\r\n\r\n`).join("")
  const bytes = new TextEncoder().encode(text)
  // One byte per chunk forces split Unicode and CRLF boundaries.
  return new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  }), { headers: { "content-type": "text/event-stream" } })
}

describe("live provider streaming", () => {
  it.each(["openai", "openrouter"] as const)("streams %s answer content and meters final usage, never reasoning", async (id) => {
    const fetchFn = vi.fn<typeof fetch>(async () => sse([
      { choices: [{ index: 0, delta: { reasoning_content: "private thinking" } }] },
      { choices: [{ index: 0, delta: { content: '{"answer":"Café ' } }] },
      { choices: [{ index: 0, delta: { content: 'research","citedPageIds":[]}' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 15, completion_tokens: 30 } },
      "[DONE]",
    ]))
    const provider = new OpenAICompatProvider(id, "test", "http://local", fetchFn)
    const snapshots: string[] = []
    const result = await provider.complete("qwen", { messages: [], thinking: "enabled", onText: (s) => snapshots.push(s) })
    expect(snapshots).toEqual(["", '{"answer":"Café ', '{"answer":"Café research","citedPageIds":[]}'])
    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 30 })
    expect(result.text).not.toContain("private thinking")
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true }, chat_template_kwargs: { enable_thinking: true } })
  })

  it("rejects an interrupted stream, even if its partial JSON was valid", async () => {
    const provider = new OpenAICompatProvider("openai", "test", "http://local", async () => sse([
      { choices: [{ delta: { content: '{"answer":"partial"}' } }] },
    ]))
    await expect(provider.complete("m", { messages: [], onText: () => {} })).rejects.toThrow(/interrupted/)
  })

  it("streams Gemini answer parts, excludes thoughts and counts thinking tokens", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => sse([
      { candidates: [{ content: { parts: [{ text: "private", thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: "Café " }] } }] },
      { candidates: [{ content: { parts: [{ text: "research" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, thoughtsTokenCount: 6 } },
    ]))
    const onText = vi.fn()
    const result = await new GoogleProvider("test", fetchFn).complete("gemini", { messages: [], onText })
    expect(fetchFn.mock.calls[0][0]).toContain("streamGenerateContent?alt=sse")
    expect(onText.mock.calls.map(([t]) => t)).toEqual(["", "Café ", "Café research"])
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 10 })
  })

  it("streams Anthropic text through the SDK with final usage", async () => {
    const fetchFn: typeof fetch = async () => sse([
      { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", content: [], model: "m", stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Café " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "research" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ])
    const onText = vi.fn()
    const result = await new AnthropicProvider("test", fetchFn).complete("m", { messages: [{ role: "user", content: "test" }], onText })
    expect(onText.mock.calls.map(([t]) => t)).toEqual(["", "Café ", "Café research"])
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })
})

describe("structured answer preview", () => {
  it("decodes escapes and split unicode without leaking other fields or JSON syntax", () => {
    expect(streamedStringField('{"nested":{"answer":"secret"},"answer":"Hello\\n\\"Café\\" \\uD83D', "answer")).toBe('Hello\n"Café" ')
    expect(streamedStringField('{"answer":"Hi \\uD83D\\uDE00', "answer")).toBe("Hi 😀")
    expect(streamedStringField('```json\n{"citedPageIds":[],"answer":"Hi', "answer")).toBe("Hi")
    expect(streamedStringField('[{"answer":"wrong root"}]', "answer")).toBe("")
    expect(streamedStringField('{"citedPageIds":["answer","secret"]}', "answer")).toBe("")
  })

  it("replaces a failed validation attempt and still validates citations", async () => {
    let calls = 0
    const provider: LLMProvider = { id: "openai", async complete(_m, req) {
      req.onText?.("")
      const text = ++calls === 1 ? '{"answer":"Wrong","citedPageIds":42}' : '{"answer":"Correct","citedPageIds":[]}'
      req.onText?.(text)
      return { text, usage: { inputTokens: 5, outputTokens: 5 }, model: "m", provider: "openai", stopReason: "stop" }
    } }
    const onText = vi.fn()
    const result = await completeStructured(provider, "m", { messages: [] }, z.object({ answer: z.string(), citedPageIds: z.array(z.string()) }), { streamField: "answer", onText })
    expect(onText.mock.calls.map(([s]) => s)).toEqual(["", "Wrong", "", "Correct"])
    expect(result.value).toEqual({ answer: "Correct", citedPageIds: [] })
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 10 })
  })
})
