import Anthropic from "@anthropic-ai/sdk"
import type { LLMProvider, LLMRequest, LLMResult, ProviderId } from "../types"
import {
  LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMRefusalError, LLMTransientError,
} from "../types"

export class AnthropicProvider implements LLMProvider {
  readonly id: ProviderId = "anthropic"
  private client: Anthropic

  constructor(apiKey: string, fetchFn?: typeof fetch) {
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true, // BYOK: the user's own key, from local settings
      maxRetries: 0,                 // retries are handled by withRetry at the harness layer
      ...(fetchFn ? { fetch: fetchFn } : {}),
    })
  }

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    try {
      req.onText?.("")
      const params = {
        model,
        max_tokens: req.maxTokens ?? 8192,
        ...(system ? { system } : {}),
        messages,
        ...(req.jsonSchema
          ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } } }
          : {}),
      }
      let streamed = ""
      const response = req.onText
        ? await this.client.messages.stream(params).on("text", (delta) => {
            streamed += delta
            req.onText!(streamed)
          }).finalMessage()
        : await this.client.messages.create(params)

      if (response.stop_reason === "refusal") {
        throw new LLMRefusalError("provider declined the request")
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
      return {
        text,
        json: req.jsonSchema ? safeParse(text) : undefined,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        model: response.model,
        provider: this.id,
        stopReason: response.stop_reason ?? "unknown",
      }
    } catch (e) {
      throw mapError(e)
    }
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

function mapError(e: unknown): unknown {
  if (e instanceof LLMRefusalError) return e
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new LLMAuthError(e.message)
  }
  if (e instanceof Anthropic.RateLimitError) {
    const raw = e.headers?.get?.("retry-after")
    const ra = raw != null ? Number(raw) : NaN
    return new LLMRateLimitError(e.message, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined)
  }
  if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    return new LLMTransientError(e instanceof Error ? e.message : "connection error")
  }
  if (e instanceof Anthropic.APIError) return new LLMBadRequestError(e.message)
  return e
}
