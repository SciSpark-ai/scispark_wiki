import type { LLMProvider, LLMRequest, LLMResult, ProviderId } from "../types"
import {
  LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMTransientError,
} from "../types"

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export class GoogleProvider implements LLMProvider {
  readonly id: ProviderId = "google"

  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    const systemText = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }))

    const generationConfig: Record<string, unknown> = {
      ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
      ...(req.jsonSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: stripUnsupportedSchemaKeywords(req.jsonSchema),
          }
        : {}),
    }

    const body: Record<string, unknown> = {
      contents,
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    }

    let res: Response
    try {
      res = await this.fetchFn(`${BASE_URL}/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
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

    const data = (await res.json().catch(() => ({}))) as GenerateContentResponse
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
    return {
      text,
      json: req.jsonSchema ? safeParse(text) : undefined,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: data.modelVersion ?? model,
      provider: this.id,
      stopReason: data.candidates?.[0]?.finishReason ?? "unknown",
    }
  }
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  modelVersion?: string
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

// Gemini's `responseSchema` accepts only a subset of OpenAPI 3.0 / JSON Schema
// (ai.google.dev/api/caching#Schema, "generateContent" v1beta reference):
//   type, format, title, description, nullable, enum, maxItems, minItems,
//   properties, required, minProperties, maxProperties, minLength, maxLength,
//   pattern, example, anyOf, propertyOrdering, default, items, minimum, maximum.
// Keywords produced by our JSON-Schema callers but NOT in that list — notably
// `additionalProperties` (also `$ref`, `oneOf`, `allOf`, `patternProperties`,
// `const`, `multipleOf`, `uniqueItems`, `exclusiveMinimum`/`exclusiveMaximum`,
// `contains`, `if`/`then`/`else`) — are stripped recursively so requests don't
// get rejected by the stricter dialect.
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "additionalProperties", "$ref", "oneOf", "allOf", "patternProperties",
  "const", "multipleOf", "uniqueItems", "exclusiveMinimum", "exclusiveMaximum",
  "contains", "if", "then", "else", "$schema", "$id",
])

function stripUnsupportedSchemaKeywords(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnsupportedSchemaKeywords)
  if (schema === null || typeof schema !== "object") return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue
    out[key] = stripUnsupportedSchemaKeywords(value)
  }
  return out
}
