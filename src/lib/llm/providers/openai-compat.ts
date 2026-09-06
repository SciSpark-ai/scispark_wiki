import type { LLMProvider, LLMRequest, LLMResult } from "../types"
import { readSseData } from "../sse"
import {
  LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMTransientError,
} from "../types"

// Per-request wall-clock ceiling for an LLM HTTP call. Chosen generously — a
// strong-tier completion legitimately runs tens of seconds — so it never trips a
// healthy call, only bounds a hung one. Without it, a provider that accepts the
// connection then never responds (observed on GMI's flaky Anthropic passthrough)
// hangs the caller forever: a sequential skill loop (e.g. the trending refresh)
// then never reaches its persist step even though earlier calls already billed.
// On timeout the request aborts → surfaces as a transient error → withRetry
// retries a bounded number of times, then the caller degrades gracefully.
export const DEFAULT_LLM_TIMEOUT_MS = 120_000

export class OpenAICompatProvider implements LLMProvider {
  constructor(
    readonly id: "openai" | "openrouter",
    private apiKey: string,
    private baseUrl: string,
    private fetchFn: typeof fetch = fetch,
    private timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
  ) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    if (!req.jsonSchema) {
      return this.send(model, req, "none")
    }
    // Native structured output (response_format) is the preferred path. GMI Cloud's
    // Anthropic passthrough intermittently rejects the WHOLE structured-output field
    // with a 400 ("output_config.format: Extra inputs are not permitted") via
    // backend-replica variance — a transient infra flake, not a schema defect
    // (CLAUDE.md). On exactly that rejection, fall back once to prompt-embedded JSON:
    // drop response_format and instruct the model to emit schema-conformant JSON in
    // its text, which safeParse extracts. zod re-validation in completeStructured
    // remains the enforcement layer either way.
    //
    // We deliberately re-try native (not a sticky skip-native flag) on every call:
    // the flake is INTERMITTENT, so the next replica usually accepts native, and
    // native is more schema-reliable than prompt-JSON — trading it away permanently
    // after one 400 would degrade all later calls. Cost note: this method is itself
    // wrapped by runSkill's withRetry (transient-retry) and completeStructured's
    // validation-retry, so a pathological run (native flake + a transient error on
    // the fallback) can compound to several HTTP round-trips for one logical call.
    // It is bounded (no loop) and rare in practice (live gate: fallback rarely fires).
    try {
      return await this.send(model, req, "native")
    } catch (e) {
      if (e instanceof LLMBadRequestError && isStructuredOutputRejection(e.message)) {
        fallbackStats.promptJsonFallbacks++
        console.warn(
          `[openai-compat] structured-output fallback fired (provider=${this.id}, model=${model}): ${e.message}`,
        )
        return await this.send(model, req, "prompt")
      }
      throw e
    }
  }

  /**
   * One request attempt. `schemaMode` picks how a requested `jsonSchema` is conveyed:
   * "none" = no schema; "native" = OpenAI `response_format`; "prompt" = schema embedded
   * as an instruction in the messages (the GMI-flake fallback), no `response_format`.
   */
  private async send(
    model: string,
    req: LLMRequest,
    schemaMode: "none" | "native" | "prompt",
  ): Promise<LLMResult> {
    req.onText?.("")
    const messages =
      schemaMode === "prompt" && req.jsonSchema
        ? [...req.messages, { role: "user" as const, content: buildPromptJsonInstruction(req.jsonSchema) }]
        : req.messages

    const body: Record<string, unknown> = {
      model,
      messages,
      ...(req.onText ? { stream: true, stream_options: { include_usage: true } } : {}),
      ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      ...qwenGenerationControls(model, req),
      ...(schemaMode === "native" && req.jsonSchema
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

    // Abort the whole request (connection, headers, AND body read) if it
    // exceeds `timeoutMs`. The timer stays armed until this method exits via the
    // `finally`, so a provider that streams headers then stalls on the body is
    // caught too, not just a pre-header hang.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
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
          signal: controller.signal,
        })
      } catch (e) {
        // A timeout-abort and a genuine network error both land here; both are
        // transient (withRetry retries them), but label the timeout distinctly.
        throw controller.signal.aborted
          ? new LLMTransientError(`request timed out after ${this.timeoutMs}ms`)
          : new LLMTransientError(e instanceof Error ? e.message : "network error")
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

      let data: ChatCompletionResponse
      try {
        data = req.onText ? await readChatStream(res, req.onText) : (await res.json()) as ChatCompletionResponse
      } catch (e) {
        // Only remap the timeout-abort case; a genuine malformed-body error
        // keeps its original shape/behavior (unchanged from before this guard).
        if (controller.signal.aborted) throw new LLMTransientError(`request timed out after ${this.timeoutMs}ms`)
        throw e
      }
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
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Qwen3 hybrid-thinking models default to xhigh thinking. Qwen documents both
 * a chat-template switch and mode-specific sampling values, plus
 * `reasoning_effort` for bounded thinking. Only explicit Qwen requests receive
 * these extra fields so other OpenAI-compatible payloads remain unchanged.
 */
function qwenGenerationControls(model: string, req: LLMRequest): Record<string, unknown> {
  if (!model.toLowerCase().includes("qwen")) return {}

  if (req.thinking === "disabled") {
    return {
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      presence_penalty: 1.5,
      chat_template_kwargs: { enable_thinking: false },
    }
  }

  if (req.thinking === "enabled") {
    return {
      temperature: 1,
      top_p: 0.95,
      top_k: 20,
      presence_penalty: 0,
      chat_template_kwargs: { enable_thinking: true },
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    }
  }

  return {}
}

// Matches the GMI Bedrock-passthrough rejection of the whole structured-output
// field — deliberately specific so a genuinely malformed request (a real 400)
// still surfaces rather than silently retrying. The observed body is
// "output_config.format: Extra inputs are not permitted".
export function isStructuredOutputRejection(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes("output_config") || m.includes("response_format")
}

// Module-level telemetry for the prompt-JSON fallback (see the isStructuredOutputRejection
// branch in complete() above). Counts how often the GMI-flake fallback actually fires, so
// operators can watch it via /api/skills/debug/ping rather than grepping logs blind.
// Process-lifetime counter, not per-request — fine for a single-process dev/debug surface;
// a multi-instance deployment would need this centralized to be meaningful across instances.
const fallbackStats = { promptJsonFallbacks: 0 }

export function getFallbackStats(): { promptJsonFallbacks: number } {
  return { ...fallbackStats }
}

// Test-only reset — production code never calls this.
export function resetFallbackStats(): void {
  fallbackStats.promptJsonFallbacks = 0
}

// The prompt-JSON fallback instruction: appended as a final user turn when the
// native structured-output path is rejected. The full JSON Schema guides the
// model; the "only JSON, no prose/fences" directive keeps safeParse's job simple
// (though safeParse also tolerates fences/prose defensively).
function buildPromptJsonInstruction(jsonSchema: Record<string, unknown>): string {
  const { $schema, ...rest } = jsonSchema as Record<string, unknown>
  void $schema
  return [
    "Respond with ONLY a single JSON value that validates against this JSON Schema.",
    "Do not include any prose, explanation, or markdown code fences — output raw JSON only.",
    "",
    JSON.stringify(rest),
  ].join("\n")
}

interface ChatCompletionResponse {
  model?: string
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

async function readChatStream(res: Response, onText: (text: string) => void): Promise<ChatCompletionResponse> {
  let content = ""
  let finished = false
  let done = false
  const result: ChatCompletionResponse = {}
  for await (const data of readSseData(res)) {
    if (data === "[DONE]") { done = true; break }
    const chunk = JSON.parse(data) as Omit<ChatCompletionResponse, "choices"> & {
      error?: { message?: string }
      choices?: Array<{ index?: number; delta?: { content?: string; refusal?: string }; finish_reason?: string }>
    }
    if (chunk.error) throw new LLMTransientError(chunk.error.message ?? "Provider stream failed")
    const choice = chunk.choices?.find((entry) => (entry.index ?? 0) === 0)
    if (choice?.delta?.refusal) throw new LLMBadRequestError("Provider declined the request")
    if (typeof choice?.delta?.content === "string") {
      content += choice.delta.content
      onText(content)
    }
    if (choice?.finish_reason) {
      finished = true
      result.choices = [{ message: { content }, finish_reason: choice.finish_reason }]
    }
    if (chunk.model) result.model = chunk.model
    if (chunk.usage) result.usage = chunk.usage
  }
  if (!finished || !done) throw new LLMTransientError("Provider stream interrupted before completion")
  return result
}

// Parses JSON from a model response. The native structured-output path returns
// pure JSON (the first, direct attempt succeeds). The prompt-JSON fallback path
// may wrap the JSON in a ```json fence or surround it with prose despite the
// instruction, so we defensively try: (1) the raw text, (2) a fenced block,
// (3) the outermost {...} object, (4) the outermost [...] array.
function safeParse(text: string): unknown {
  for (const candidate of jsonCandidates(text)) {
    try { return JSON.parse(candidate) } catch { /* try next */ }
  }
  return undefined
}

function jsonCandidates(text: string): string[] {
  const out: string[] = [text.trim()]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) out.push(fenced[1].trim())
  const objStart = text.indexOf("{")
  const objEnd = text.lastIndexOf("}")
  if (objStart >= 0 && objEnd > objStart) out.push(text.slice(objStart, objEnd + 1))
  const arrStart = text.indexOf("[")
  const arrEnd = text.lastIndexOf("]")
  if (arrStart >= 0 && arrEnd > arrStart) out.push(text.slice(arrStart, arrEnd + 1))
  return out
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
