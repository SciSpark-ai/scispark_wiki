import type { LLMProvider, LLMRequest, LLMResult } from "../types"
import {
  LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMTransientError,
} from "../types"

export class OpenAICompatProvider implements LLMProvider {
  constructor(
    readonly id: "openai" | "openrouter",
    private apiKey: string,
    private baseUrl: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      ...(req.jsonSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: req.schemaName ?? "result",
                // strict: false — client-side zod validation in completeStructured
                // (with its own mismatch-retry) is the real enforcement layer here.
                // OpenAI's strict:true requires every key in `properties` to also
                // appear in `required`, but zod v4's `z.toJSONSchema` legitimately
                // emits optional fields outside `required`; strict:true would 400 on
                // any schema using `.optional()`.
                strict: false,
                schema: stripSchemaKeyword(req.jsonSchema),
              },
            },
          }
        : {}),
    }

    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...(this.id === "openrouter"
            ? {
                // OpenRouter attribution convention (openrouter.ai/docs/app-attribution).
                // X-Title is the legacy header name; X-OpenRouter-Title is the current
                // documented name as of 2026. Both are still honored, so send both.
                "HTTP-Referer": "https://scispark.ai",
                "X-Title": "SciSpark",
                "X-OpenRouter-Title": "SciSpark",
              }
            : {}),
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new LLMTransientError(e instanceof Error ? e.message : "network error")
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      if (res.status === 401 || res.status === 403) throw new LLMAuthError(text || `HTTP ${res.status}`)
      if (res.status === 429) {
        // NB: header absent → get() returns null and Number(null) === 0 — must not become a 0ms hint
        const raw = res.headers.get("retry-after")
        const ra = raw != null ? Number(raw) : NaN
        throw new LLMRateLimitError(text || "rate limited", Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined)
      }
      if (res.status >= 500) throw new LLMTransientError(text || `HTTP ${res.status}`)
      throw new LLMBadRequestError(text || `HTTP ${res.status}`)
    }

    const data = (await res.json()) as ChatCompletionResponse
    const text: string = data.choices?.[0]?.message?.content ?? ""
    return {
      text,
      json: req.jsonSchema ? safeParse(text) : undefined,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      model: data.model ?? model,
      provider: this.id,
      stopReason: data.choices?.[0]?.finish_reason ?? "unknown",
    }
  }
}

interface ChatCompletionResponse {
  model?: string
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

// Removes a top-level "$schema" keyword (e.g. from zod v4's z.toJSONSchema output)
// before sending to OpenAI, which doesn't expect JSON Schema meta-keywords in the
// request body. Returns a shallow copy; does not mutate the caller's schema.
function stripSchemaKeyword(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...schema }
  delete copy.$schema
  return copy
}

export const openAIProvider = (key: string, fetchFn?: typeof fetch) =>
  new OpenAICompatProvider("openai", key, "https://api.openai.com/v1", fetchFn)
export const openRouterProvider = (key: string, fetchFn?: typeof fetch) =>
  new OpenAICompatProvider("openrouter", key, "https://openrouter.ai/api/v1", fetchFn)
