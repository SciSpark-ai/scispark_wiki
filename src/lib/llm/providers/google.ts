import type { LLMProvider, LLMRequest, LLMResult, ProviderId } from "../types"
import { readSseData } from "../sse"
import {
  LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMTransientError,
} from "../types"

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export class GoogleProvider implements LLMProvider {
  readonly id: ProviderId = "google"

  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    req.onText?.("")
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
            responseSchema: stripUnsupportedSchemaKeywords(resolveRefs(req.jsonSchema)),
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
      const method = req.onText ? "streamGenerateContent?alt=sse" : "generateContent"
      res = await this.fetchFn(`${BASE_URL}/models/${model}:${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
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

    const data = req.onText
      ? await readGoogleStream(res, req.onText)
      : (await res.json().catch(() => ({}))) as GenerateContentResponse
    const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? ""
    return {
      text,
      json: req.jsonSchema ? safeParse(text) : undefined,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
        ...(!data.usageMetadata || data.usageMetadata.promptTokenCount == null || data.usageMetadata.candidatesTokenCount == null ? { reported: false } : {}),
      },
      model: data.modelVersion ?? model,
      provider: this.id,
      stopReason: data.candidates?.[0]?.finishReason ?? "unknown",
    }
  }
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
  modelVersion?: string
}

async function readGoogleStream(res: Response, onText: (text: string) => void): Promise<GenerateContentResponse> {
  let text = ""
  let finishReason: string | undefined
  let result: GenerateContentResponse = {}
  for await (const data of readSseData(res)) {
    const chunk = JSON.parse(data) as GenerateContentResponse & { error?: { message?: string } }
    if (chunk.error) throw new LLMTransientError(chunk.error.message ?? "Provider stream failed")
    const candidate = chunk.candidates?.[0]
    const delta = candidate?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? ""
    if (delta) { text += delta; onText(text) }
    finishReason = candidate?.finishReason ?? finishReason
    result = { ...result, ...chunk }
  }
  if (!finishReason) throw new LLMTransientError("Provider stream interrupted before completion")
  return { ...result, candidates: [{ content: { parts: [{ text }] }, finishReason }] }
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
// `additionalProperties` (also `oneOf`, `allOf`, `patternProperties`,
// `const`, `multipleOf`, `uniqueItems`, `exclusiveMinimum`/`exclusiveMaximum`,
// `contains`, `if`/`then`/`else`) — are stripped recursively so requests don't
// get rejected by the stricter dialect. `$ref` is *not* stripped here — it is
// resolved (inlined) by `resolveRefs` before this runs; `$ref` is kept in this
// set only as a defensive backstop in case one somehow survives resolution.
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

// zod v4's `toJSONSchema()` (and other JSON-Schema generators) emit `$ref`
// pointers into a top-level `$defs` (or legacy `definitions`) bag whenever a
// sub-schema is recursive or reused by reference. Gemini's `Schema` dialect
// has no `$ref`/`$defs` support at all, so refs must be resolved (inlined)
// before the schema is sent — silently deleting `$ref` (the previous
// behavior) corrupts the schema instead of erroring.
const REF_POINTER = /^#\/(?:\$defs|definitions)\/(.+)$/

function resolveRefs(schema: unknown): unknown {
  const defs = collectDefs(schema)
  return resolveRefNode(schema, defs, new Set())
}

function collectDefs(schema: unknown): Record<string, unknown> {
  const defs: Record<string, unknown> = {}
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return defs
  const obj = schema as Record<string, unknown>
  if (obj.$defs !== undefined && typeof obj.$defs === "object" && obj.$defs !== null) {
    Object.assign(defs, obj.$defs as Record<string, unknown>)
  }
  if (obj.definitions !== undefined && typeof obj.definitions === "object" && obj.definitions !== null) {
    Object.assign(defs, obj.definitions as Record<string, unknown>)
  }
  return defs
}

function resolveRefNode(node: unknown, defs: Record<string, unknown>, path: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => resolveRefNode(item, defs, path))
  if (node === null || typeof node !== "object") return node

  const obj = node as Record<string, unknown>
  if (typeof obj.$ref === "string") {
    const match = REF_POINTER.exec(obj.$ref)
    if (!match || !(match[1] in defs)) {
      throw new LLMBadRequestError(`unsupported $ref: ${obj.$ref}`)
    }
    const name = match[1]
    if (path.has(name)) {
      throw new LLMBadRequestError("recursive schemas are not supported by the Google provider")
    }
    const nextPath = new Set(path)
    nextPath.add(name)
    return resolveRefNode(defs[name], defs, nextPath)
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === "$defs" || key === "definitions") continue
    out[key] = resolveRefNode(value, defs, path)
  }
  return out
}
