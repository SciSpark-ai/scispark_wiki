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

// Validation-constraint keywords that some backends' structured-output
// implementations reject as "extra inputs" (live-verified 2026-07-13 against
// GMI Cloud's Anthropic passthrough: minItems/maxItems and minimum/maximum on
// the wire schema → 400 "output_config.format: Extra inputs are not permitted").
// Stripping them is safe: the harness re-validates every structured result
// client-side with the full zod schema (with retry-on-invalid), so these
// constraints are still enforced — just not by the provider.
const UNSUPPORTED_CONSTRAINT_KEYWORDS = [
  "minItems", "maxItems", "minLength", "maxLength",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf", "pattern", "minProperties", "maxProperties", "format",
] as const

// Keys whose value is a map of NAMES → subschemas. Keyword filtering must not
// apply to the names themselves (a property legitimately named "pattern" or
// "maxLength" is data, not a constraint keyword) — only to schema nodes.
const NAME_MAP_KEYS = ["properties", "$defs", "definitions", "patternProperties"] as const

// Prepares a zod-emitted JSON schema for the wire: drops the "$schema"
// meta-keyword and recursively removes validation-constraint keywords the
// backends don't accept (see above). Pure — never mutates the input.
function sanitizeSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchemaNode)
  if (node === null || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$schema") continue
    if ((UNSUPPORTED_CONSTRAINT_KEYWORDS as readonly string[]).includes(key)) continue
    if ((NAME_MAP_KEYS as readonly string[]).includes(key) && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const map: Record<string, unknown> = {}
      for (const [name, subschema] of Object.entries(value as Record<string, unknown>)) {
        map[name] = sanitizeSchemaNode(subschema)
      }
      out[key] = map
      continue
    }
    out[key] = sanitizeSchemaNode(value)
  }
  return out
}

function stripSchemaKeyword(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSchemaNode(schema) as Record<string, unknown>
}

export const openAIProvider = (key: string, fetchFn?: typeof fetch) =>
  new OpenAICompatProvider("openai", key, "https://api.openai.com/v1", fetchFn)
export const openRouterProvider = (key: string, fetchFn?: typeof fetch) =>
  new OpenAICompatProvider("openrouter", key, "https://openrouter.ai/api/v1", fetchFn)
