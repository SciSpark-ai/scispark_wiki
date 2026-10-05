import type { LLMProvider, LLMRequest, LLMResult, ProviderId } from "../types"
import {
  LLMError, LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMRefusalError, LLMTransientError,
} from "../types"
import { readSseData } from "../sse"
import { parseJsonLoosely } from "../json"

const BASE_URL = "https://api.anthropic.com"
const API_VERSION = "2023-06-01"
// Covers connection, headers AND body (the signal aborts a streaming body too).
const TIMEOUT_MS = 120_000

interface MessagesResponse {
  model?: string
  content?: Array<{ type: string; text?: string }>
  stop_reason?: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
}

export class AnthropicProvider implements LLMProvider {
  readonly id: ProviderId = "anthropic"

  // BYOK: the user's own key from local settings; retries live in withRetry at the harness layer.
  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch, private timeoutMs = TIMEOUT_MS) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    const body = {
      model,
      max_tokens: req.maxTokens ?? 8192,
      ...(system ? { system } : {}),
      messages,
      ...(req.jsonSchema ? { output_config: { format: { type: "json_schema", schema: req.jsonSchema } } } : {}),
      ...(req.onText ? { stream: true } : {}),
    }

    req.onText?.("")
    const signal = AbortSignal.timeout(this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchFn(`${BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (e) {
      throw signal.aborted
        ? new LLMTransientError(`request timed out after ${this.timeoutMs}ms`)
        : new LLMTransientError(e instanceof Error ? e.message : "network error")
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      if (res.status === 401 || res.status === 403) throw new LLMAuthError(text || `HTTP ${res.status}`)
      if (res.status === 429) {
        // Header absent → get() is null and Number(null) is 0 — must not become a 0ms hint.
        const raw = res.headers.get("retry-after")
        const ra = raw != null ? Number(raw) : NaN
        throw new LLMRateLimitError(text || "rate limited", Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined)
      }
      if (res.status >= 500) throw new LLMTransientError(text || `HTTP ${res.status}`)
      throw new LLMBadRequestError(text || `HTTP ${res.status}`)
    }

    let data: MessagesResponse
    try {
      data = req.onText ? await readMessageStream(res, req.onText) : (await res.json()) as MessagesResponse
    } catch (e) {
      if (e instanceof LLMError) throw e
      throw signal.aborted
        ? new LLMTransientError(`request timed out after ${this.timeoutMs}ms`)
        : new LLMBadRequestError(e instanceof Error ? e.message : "malformed provider response")
    }
    if (data.stop_reason === "refusal") throw new LLMRefusalError("provider declined the request")
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
    return {
      text,
      json: req.jsonSchema ? parseJsonLoosely(text) : undefined,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        ...(data.usage?.input_tokens == null || data.usage?.output_tokens == null ? { reported: false } : {}),
      },
      model: data.model ?? model,
      provider: this.id,
      stopReason: data.stop_reason ?? "unknown",
    }
  }
}

/** Folds the Messages API event stream into one response, snapshotting the text so far to `onText`. */
async function readMessageStream(res: Response, onText: (text: string) => void): Promise<MessagesResponse> {
  const result: MessagesResponse = { usage: {} }
  let text = ""
  let stopped = false
  for await (const data of readSseData(res)) {
    const event = JSON.parse(data) as {
      type: string
      message?: MessagesResponse
      delta?: { type?: string; text?: string; stop_reason?: string | null }
      usage?: { output_tokens?: number }
      error?: { message?: string }
    }
    if (event.type === "error") throw new LLMTransientError(event.error?.message ?? "Provider stream failed")
    if (event.type === "message_start" && event.message) {
      result.model = event.message.model
      result.usage = { ...event.message.usage }
    } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      text += event.delta.text ?? ""
      onText(text)
    } else if (event.type === "message_delta") {
      if (event.delta?.stop_reason) result.stop_reason = event.delta.stop_reason
      if (event.usage?.output_tokens != null) result.usage = { ...result.usage, output_tokens: event.usage.output_tokens }
    } else if (event.type === "message_stop") {
      stopped = true
    }
  }
  if (!stopped) throw new LLMTransientError("Provider stream interrupted before completion")
  result.content = [{ type: "text", text }]
  return result
}
