# M2: LLM Harness Implementation Plan

> ## STATUS (2026-07-12): implementation COMPLETE on branch `m2-llm-harness`, merge deferred by Tong
>
> All 11 tasks done; final whole-branch review verdict **READY TO MERGE** at commit `9c9f127` (123/123 tests, tsc/eslint clean). In-loop reviews caught and fixed 5 serious defects: 429 retry-storm, Gemini `$ref` schema corruption, meter write race, **vault export leaking BYOK keys** (settings.json now excluded from export+import), budget bypass via provider-echoed model ids.
>
> ### ✅ GATE PASSED 2026-07-12: live end-to-end verification via GMI Cloud (anthropic/claude-sonnet-5)
> After Tong unblocked api.gmi-serving.com (Xfinity Advanced Security), the env-gated live gate passed 4/4 on first run — no fixes required: plain completion ("pong", usage 18/4 tokens), zod-structured output (validated first try), full runSkill (status ok, metered, run record persisted, **costUsd $0.000114 exactly matching sonnet-5 rates via prefix-fallback pricing**). Browser CORS to GMI confirmed open (preflight passes; 401 with dummy token visible to JS), so the /debug/llm BYOK path is viable. Remaining merge items below are now reduced to: optional price spot-check for the OpenAI/Google default rows (only matter if those defaults are used), and the one-time /debug/llm click-through if Tong wants to see it in the UI (the same code paths are now live-verified headlessly).
>
> ### (superseded) Update 2026-07-12: GMI Cloud support added, live gate was BLOCKED by network filter
> Commit `c50e090` adds `baseUrls` overrides in settings (+ /debug/llm field) so any OpenAI-compatible endpoint works under the "openai"/"openrouter" provider ids, and an env-gated live test (`src/lib/llm/__tests__/live-openai-compat.test.ts`) that runs the full gate (plain completion, structured+zod, runSkill with budget/metering/run-record) in one command. Tong's GMI Cloud key was tested, but **api.gmi-serving.com is TLS-blocked machine-wide by the local network's security filter (Xfinity xFi Advanced Security — safebrowse.io warn pages)**; curl/Node/browser all fail before any HTTP. Once the domain is allowed (or on another network), run:
> `LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 LIVE_LLM_API_KEY=<key> LIVE_LLM_MODEL=claude-sonnet-5 npx vitest run src/lib/llm/__tests__/live-openai-compat.test.ts`
>
> ### Remaining before/at merge
> 1. **Manual real-key gate (Tong)** — `npm run dev`, open `/debug/llm`, paste a real key per provider (Anthropic / OpenAI / Google / OpenRouter), run "Test completion" + "Test structured"; confirm usage/cost render, `.scispark/usage/*.jsonl` grows, and the budget-exceeded path by setting dailyBudgetUsd to 0.001. This doubles as the browser-CORS check for OpenAI/Google BYOK — **if a provider blocks browser calls, do NOT silently proxy keys through our server; bring the decision back to design** (03-backend privacy stance).
> 2. **Spot-check OpenAI/Google prices** in `src/lib/llm/pricing.ts` against live pricing pages (they were sourced via WebFetch summaries; Anthropic rows are verified).
> 3. Merge `m2-llm-harness` → main (fast-forward expected), re-run suite, push.
>
> ### Ride-class Minors (fix opportunistically, tracked from final review + ledger)
> - Normalize zip entry paths on vault import (defense-in-depth for the sensitive-path skip-list).
> - Decide whether `.scispark/usage/` + `.scispark/runs/` belong in shared vault exports (privacy question, non-blocking).
> - Refusal-detection asymmetry across providers; 16-hex runId collision window; UTC budget-day boundary; Gemini keyword-stripper walks enum/default data values; vestigial `Meter.writeQueue` field.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side LLM harness every skill runs on: a 4-provider BYOK `LLMProvider` layer, tier→model mapping, zod-validated structured output with retry, per-call metering with a daily budget, the skill-runner primitives, and a `/debug/llm` verification page.

**Architecture:** Pure-TS library at `src/lib/llm/` (providers, settings, metering, budget) and `src/lib/skills/` (runner), framework-free like the vault library, tested with Vitest. Providers call LLM APIs directly from the browser with the user's key (BYOK — keys live in vault settings, never touch our server). Settings/usage persist through the existing `VaultStorage` (M1). Spec: `docs/design/04-agent-harness.md`.

**Tech Stack:** TypeScript 5, Vitest, `@anthropic-ai/sdk` (Anthropic provider), `zod` (schemas + validation), raw `fetch` for OpenAI/OpenRouter/Google (OpenAI-compatible + Gemini REST), M1 vault library.

## Global Constraints

- Skills declare **tiers** (`"fast" | "strong"`), never model names (docs/design/04). Tier→model resolution lives only in settings.
- BYOK: API keys are stored via `VaultStorage` under `.scispark/settings.json` and sent only to the respective provider — never to any SciSpark endpoint.
- Every provider call is metered (tokens + estimated USD) and budget-checked (harness-level, `BudgetExceededError` when the user's daily cap would be exceeded).
- `src/lib/llm/**` and `src/lib/skills/**` must not import React/Next or anything from `src/app`/`src/components`.
- Providers take an injectable `fetch` (or SDK `fetch` option) so request shapes are unit-testable without network.
- **API-drift guard:** the Anthropic task's request shapes below come from the current claude-api reference (verified 2026-07-12): SDK `@anthropic-ai/sdk`, browser flag `dangerouslyAllowBrowser`, structured output via `output_config.format` + `zodOutputFormat`, model IDs `claude-opus-4-8` / `claude-haiku-4-5`. For **OpenAI, OpenRouter, and Google**, the implementer MUST verify current request/response schemas against official docs (context7 or WebFetch: platform.openai.com/docs, openrouter.ai/docs, ai.google.dev/api) before implementing — the shapes in this plan are the expected baseline, not gospel; document any deltas in the task report.
- Money is `number` USD (floating point is fine for estimates; format at display).
- Commit after every task. `npm test` must stay green (M1's 40 tests + new ones).

---

### Task 1: LLM core types + errors

**Files:**
- Create: `src/lib/llm/types.ts`
- Test: `src/lib/llm/__tests__/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (imported by every later task):
  - `type Tier = "fast" | "strong"`
  - `interface LLMMessage { role: "system" | "user" | "assistant"; content: string }`
  - `interface LLMRequest { messages: LLMMessage[]; maxTokens?: number; jsonSchema?: Record<string, unknown>; schemaName?: string }` (when `jsonSchema` present, providers must use their native structured-output mechanism)
  - `interface LLMUsage { inputTokens: number; outputTokens: number }`
  - `interface LLMResult { text: string; json?: unknown; usage: LLMUsage; model: string; provider: ProviderId; stopReason: string }`
  - `type ProviderId = "anthropic" | "openai" | "google" | "openrouter"`
  - `interface LLMProvider { readonly id: ProviderId; complete(model: string, req: LLMRequest): Promise<LLMResult> }`
  - Errors: `class LLMError extends Error`; `class LLMAuthError extends LLMError` (401/403); `class LLMRateLimitError extends LLMError { retryAfterMs?: number }` (429); `class LLMTransientError extends LLMError` (5xx/network/timeout); `class LLMBadRequestError extends LLMError` (4xx other); `class LLMRefusalError extends LLMError` (provider safety refusal)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { LLMError, LLMAuthError, LLMRateLimitError, LLMTransientError, isRetryable } from "../types"

describe("llm errors", () => {
  it("classifies retryability", () => {
    expect(isRetryable(new LLMTransientError("overloaded"))).toBe(true)
    expect(isRetryable(new LLMRateLimitError("slow down"))).toBe(true)
    expect(isRetryable(new LLMAuthError("bad key"))).toBe(false)
    expect(isRetryable(new Error("random"))).toBe(false)
  })
  it("error hierarchy", () => {
    expect(new LLMAuthError("x")).toBeInstanceOf(LLMError)
    const rl = new LLMRateLimitError("x", 3000)
    expect(rl.retryAfterMs).toBe(3000)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/llm/__tests__/types.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/llm/types.ts`**

```ts
export type Tier = "fast" | "strong"
export type ProviderId = "anthropic" | "openai" | "google" | "openrouter"

export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMRequest {
  messages: LLMMessage[]
  maxTokens?: number
  /** JSON Schema — when set, the provider must use its native structured-output mechanism. */
  jsonSchema?: Record<string, unknown>
  schemaName?: string
}

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
}

export interface LLMResult {
  text: string
  json?: unknown
  usage: LLMUsage
  model: string
  provider: ProviderId
  stopReason: string
}

export interface LLMProvider {
  readonly id: ProviderId
  complete(model: string, req: LLMRequest): Promise<LLMResult>
}

export class LLMError extends Error {}
export class LLMAuthError extends LLMError {}
export class LLMBadRequestError extends LLMError {}
export class LLMRefusalError extends LLMError {}
export class LLMTransientError extends LLMError {}
export class LLMRateLimitError extends LLMError {
  constructor(message: string, public retryAfterMs?: number) {
    super(message)
  }
}

export function isRetryable(e: unknown): boolean {
  return e instanceof LLMTransientError || e instanceof LLMRateLimitError
}
```

- [ ] **Step 4: Run to verify pass** — 2 PASS.
- [ ] **Step 5: Commit** — `feat(llm): core types and error taxonomy`

---

### Task 2: Pricing table + cost estimator

**Files:**
- Create: `src/lib/llm/pricing.ts`
- Test: `src/lib/llm/__tests__/pricing.test.ts`

**Interfaces:**
- Consumes: `LLMUsage`
- Produces: `estimateCostUsd(model: string, usage: LLMUsage): number | null` (null = unknown model, caller shows "n/a" but never blocks); `PRICES: Record<string, {inPerM: number; outPerM: number}>` (exported so the AI-spend UI can show rates; editable in one place)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { estimateCostUsd } from "../pricing"

describe("estimateCostUsd", () => {
  it("computes from per-million rates", () => {
    // claude-haiku-4-5: $1/M in, $5/M out
    expect(estimateCostUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 200_000 }))
      .toBeCloseTo(1 + 1, 6)
  })
  it("returns null for unknown models", () => {
    expect(estimateCostUsd("mystery-model", { inputTokens: 10, outputTokens: 10 })).toBeNull()
  })
  it("matches prefixed model ids (openrouter routes like anthropic/claude-haiku-4-5)", () => {
    expect(estimateCostUsd("anthropic/claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0 }))
      .toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `src/lib/llm/pricing.ts`**

```ts
import type { LLMUsage } from "./types"

/** USD per million tokens. Verified 2026-07: update alongside provider price changes. */
export const PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  // Anthropic
  "claude-opus-4-8": { inPerM: 5, outPerM: 25 },
  "claude-sonnet-5": { inPerM: 3, outPerM: 15 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
  // OpenAI / Google entries: implementer fills from current official pricing pages
  // (verify via docs — do not trust recalled numbers), same shape.
}

export function estimateCostUsd(model: string, usage: LLMUsage): number | null {
  const key = model in PRICES ? model : model.split("/").pop() ?? model
  const p = PRICES[key]
  if (!p) return null
  return (usage.inputTokens / 1e6) * p.inPerM + (usage.outputTokens / 1e6) * p.outPerM
}
```

The implementer adds current OpenAI (gpt-5-class + mini-class) and Google (gemini pro/flash-class) rows after doc verification, plus one test row each.

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(llm): pricing table and cost estimator`

---

### Task 3: Mock provider + retry wrapper

**Files:**
- Create: `src/lib/llm/mock-provider.ts`, `src/lib/llm/retry.ts`
- Test: `src/lib/llm/__tests__/retry.test.ts`

**Interfaces:**
- Consumes: Task 1 types
- Produces:
  - `class MockProvider implements LLMProvider` — constructor takes `responses: Array<LLMResult | Error>`, pops one per call, records `calls: Array<{model: string; req: LLMRequest}>`. Used by every downstream test (structured output, runner, budget).
  - `withRetry<T>(fn: () => Promise<T>, opts?: {retries?: number; baseDelayMs?: number; sleep?: (ms:number)=>Promise<void>}): Promise<T>` — retries only `isRetryable` errors, exponential backoff (honors `retryAfterMs` when present), default 2 retries; injectable `sleep` for tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { withRetry } from "../retry"
import { MockProvider } from "../mock-provider"
import { LLMTransientError, LLMAuthError, type LLMResult } from "../types"

const ok = (text: string): LLMResult => ({
  text, usage: { inputTokens: 1, outputTokens: 1 },
  model: "m", provider: "anthropic", stopReason: "end_turn",
})

describe("withRetry", () => {
  it("retries transient errors then succeeds", async () => {
    const p = new MockProvider([new LLMTransientError("overloaded"), ok("hi")])
    const sleeps: number[] = []
    const result = await withRetry(() => p.complete("m", { messages: [] }), {
      sleep: async (ms) => { sleeps.push(ms) },
    })
    expect(result.text).toBe("hi")
    expect(sleeps).toHaveLength(1)
  })
  it("does not retry auth errors", async () => {
    const p = new MockProvider([new LLMAuthError("bad key"), ok("never")])
    await expect(withRetry(() => p.complete("m", { messages: [] }), { sleep: async () => {} }))
      .rejects.toThrow(LLMAuthError)
    expect(p.calls).toHaveLength(1)
  })
  it("gives up after retries and rethrows", async () => {
    const p = new MockProvider([
      new LLMTransientError("1"), new LLMTransientError("2"), new LLMTransientError("3"),
    ])
    await expect(withRetry(() => p.complete("m", { messages: [] }), { retries: 2, sleep: async () => {} }))
      .rejects.toThrow("3")
  })
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`mock-provider.ts`:

```ts
import type { LLMProvider, LLMRequest, LLMResult, ProviderId } from "./types"

export class MockProvider implements LLMProvider {
  readonly id: ProviderId = "anthropic"
  calls: Array<{ model: string; req: LLMRequest }> = []

  constructor(private responses: Array<LLMResult | Error>) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    this.calls.push({ model, req })
    const next = this.responses.shift()
    if (!next) throw new Error("MockProvider: no responses left")
    if (next instanceof Error) throw next
    return next
  }
}
```

`retry.ts`:

```ts
import { isRetryable, LLMRateLimitError } from "./types"

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const base = opts.baseDelayMs ?? 1000
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (!isRetryable(e) || attempt === retries) throw e
      const hinted = e instanceof LLMRateLimitError ? e.retryAfterMs : undefined
      await sleep(hinted ?? base * 2 ** attempt)
    }
  }
  throw lastError
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(llm): mock provider and retry wrapper`

---

### Task 4: Anthropic provider

**Files:**
- Create: `src/lib/llm/providers/anthropic.ts`
- Test: `src/lib/llm/__tests__/anthropic.test.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: Task 1 types
- Produces: `class AnthropicProvider implements LLMProvider` — `constructor(apiKey: string, fetchFn?: typeof fetch)`. Uses `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true` (BYOK browser calls are the product design; key is the user's own) and the SDK's `fetch` option for test injection. Plain requests → `client.messages.create`; `jsonSchema` requests → `output_config: {format: {type: "json_schema", schema}}`; `json` field parsed from the response text. Maps SDK errors → our taxonomy (401/403→`LLMAuthError`, 429→`LLMRateLimitError` w/ retry-after, ≥500/connection→`LLMTransientError`, `stop_reason==="refusal"`→`LLMRefusalError`, other 4xx→`LLMBadRequestError`). SDK retries disabled (`maxRetries: 0`) — retry policy lives in our `withRetry`, not doubled in the SDK.

- [ ] **Step 1: Install SDK** — `npm install @anthropic-ai/sdk zod` (zod used from Task 7 on).

- [ ] **Step 2: Write the failing test** (inject a fake `fetch` that captures the request and returns a canned Messages API response)

```ts
import { describe, it, expect } from "vitest"
import { AnthropicProvider } from "../providers/anthropic"
import { LLMAuthError } from "../types"

function fakeFetch(status: number, body: unknown): { fn: typeof fetch; captured: { url?: string; init?: RequestInit } } {
  const captured: { url?: string; init?: RequestInit } = {}
  const fn = (async (url: any, init?: any) => {
    captured.url = String(url)
    captured.init = init
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { fn, captured }
}

const OK_MESSAGE = {
  id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5",
  content: [{ type: "text", text: "hello" }],
  stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
}

describe("AnthropicProvider", () => {
  it("sends a Messages API request and maps the result", async () => {
    const { fn, captured } = fakeFetch(200, OK_MESSAGE)
    const p = new AnthropicProvider("sk-test", fn)
    const result = await p.complete("claude-haiku-4-5", {
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
    })
    expect(captured.url).toContain("/v1/messages")
    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.model).toBe("claude-haiku-4-5")
    expect(sent.system).toBe("be brief")                      // system extracted from messages
    expect(sent.messages).toEqual([{ role: "user", content: "hi" }])
    expect(result.text).toBe("hello")
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(result.provider).toBe("anthropic")
  })

  it("maps 401 to LLMAuthError", async () => {
    const { fn } = fakeFetch(401, { type: "error", error: { type: "authentication_error", message: "bad key" } })
    const p = new AnthropicProvider("sk-bad", fn)
    await expect(p.complete("claude-haiku-4-5", { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(LLMAuthError)
  })

  it("passes jsonSchema through output_config and parses json", async () => {
    const { fn, captured } = fakeFetch(200, {
      ...OK_MESSAGE,
      content: [{ type: "text", text: '{"a":1}' }],
    })
    const p = new AnthropicProvider("sk-test", fn)
    const result = await p.complete("claude-haiku-4-5", {
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"], additionalProperties: false },
    })
    const sent = JSON.parse(String(captured.init?.body))
    expect(sent.output_config?.format?.type).toBe("json_schema")
    expect(result.json).toEqual({ a: 1 })
  })
})
```

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement `src/lib/llm/providers/anthropic.ts`**

```ts
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
      const response = await this.client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 8192,
        ...(system ? { system } : {}),
        messages,
        ...(req.jsonSchema
          ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } } }
          : {}),
      })

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
    const retryAfter = Number(e.headers?.get?.("retry-after"))
    return new LLMRateLimitError(e.message, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined)
  }
  if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    return new LLMTransientError(e instanceof Error ? e.message : "connection error")
  }
  if (e instanceof Anthropic.APIError) return new LLMBadRequestError(e.message)
  return e
}
```

Note for implementer: if the SDK's error classes or `output_config` typing differ in the installed version, trust the SDK's own types/compiler over this listing and record the delta in the report. Do not switch to raw fetch.

- [ ] **Step 5: Run to verify pass, then full suite + tsc. Commit** — `feat(llm): Anthropic provider (BYOK browser, structured output, error mapping)`

---

### Task 5: OpenAI-compatible providers (OpenAI + OpenRouter)

**Files:**
- Create: `src/lib/llm/providers/openai-compat.ts`
- Test: `src/lib/llm/__tests__/openai-compat.test.ts`

**Interfaces:**
- Consumes: Task 1 types
- Produces: `class OpenAICompatProvider implements LLMProvider` — `constructor(id: "openai" | "openrouter", apiKey: string, baseUrl: string, fetchFn?: typeof fetch)`; factory helpers `openAIProvider(key, fetchFn?)` (`https://api.openai.com/v1`) and `openRouterProvider(key, fetchFn?)` (`https://openrouter.ai/api/v1`). POST `{baseUrl}/chat/completions` with `Authorization: Bearer`; `jsonSchema` → `response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}`; maps `choices[0].message.content`, `usage.prompt_tokens/completion_tokens`; HTTP status → error taxonomy (429 honors `retry-after` header). OpenRouter additionally sends `HTTP-Referer` + `X-Title` headers (their attribution convention).

**Pre-step (API-drift guard):** verify the chat-completions request/response shape and `response_format` structured-output syntax against current OpenAI + OpenRouter docs (context7/WebFetch). Record deltas in the report and adjust code + tests accordingly.

- [ ] **Step 1: Write the failing test** — mirror the Anthropic test structure: fake fetch capturing request; assert URL `…/chat/completions`, bearer header, `messages` passthrough (system stays in-array for this API), `response_format` shape when `jsonSchema` set, usage mapping from `prompt_tokens`/`completion_tokens`, 401→`LLMAuthError`, 429 with `retry-after: 2` → `LLMRateLimitError` with `retryAfterMs === 2000`, 500→`LLMTransientError`. One test verifies `openRouterProvider` hits `openrouter.ai` and `id === "openrouter"`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** (complete implementation — transcribe, adjusting only for verified doc deltas):

```ts
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
              json_schema: { name: req.schemaName ?? "result", strict: true, schema: req.jsonSchema },
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
            ? { "HTTP-Referer": "https://scispark.ai", "X-Title": "SciSpark" }
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

    const data = (await res.json()) as any
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

function safeParse(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

export const openAIProvider = (key: string, fetchFn?: typeof fetch) =>
  new OpenAICompatProvider("openai", key, "https://api.openai.com/v1", fetchFn)
export const openRouterProvider = (key: string, fetchFn?: typeof fetch) =>
  new OpenAICompatProvider("openrouter", key, "https://openrouter.ai/api/v1", fetchFn)
```

- [ ] **Step 4: Run to verify pass. Commit** — `feat(llm): OpenAI + OpenRouter providers via openai-compatible endpoint`

---

### Task 6: Google (Gemini) provider

**Files:**
- Create: `src/lib/llm/providers/google.ts`
- Test: `src/lib/llm/__tests__/google.test.ts`

**Interfaces:**
- Consumes: Task 1 types
- Produces: `class GoogleProvider implements LLMProvider` — `constructor(apiKey: string, fetchFn?: typeof fetch)`. POST `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with `x-goog-api-key` header; system messages → `systemInstruction`; user/assistant → `contents` roles `user`/`model`; `jsonSchema` → `generationConfig: {responseMimeType: "application/json", responseSchema}` (Gemini's schema dialect — implementer verifies and converts unsupported keywords like `additionalProperties` by stripping); usage from `usageMetadata.promptTokenCount`/`candidatesTokenCount`; same error taxonomy mapping.

**Pre-step (API-drift guard):** verify `generateContent` request/response shape + structured-output config against current Google AI docs. Record deltas.

- [ ] **Step 1: Failing test** — same fake-fetch pattern: assert URL contains `models/gemini-test:generateContent`, `x-goog-api-key` header, `systemInstruction` mapping, `contents` role mapping (`assistant`→`model`), text extraction from `candidates[0].content.parts[].text`, usage mapping, 401/403→`LLMAuthError`, 429→`LLMRateLimitError`, 500→`LLMTransientError`.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** following the same structure as Task 5 (fetch, status→error mapping, safeParse for json). Text: `data.candidates?.[0]?.content?.parts?.map((p:any)=>p.text ?? "").join("")`; stopReason: `data.candidates?.[0]?.finishReason ?? "unknown"`.
- [ ] **Step 4: Verify pass. Commit** — `feat(llm): Google Gemini provider`

---

### Task 7: Structured completion with zod validation + retry-with-error

**Files:**
- Create: `src/lib/llm/structured.ts`
- Test: `src/lib/llm/__tests__/structured.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`, `LLMRequest`, zod
- Produces: `completeStructured<T>(provider: LLMProvider, model: string, req: Omit<LLMRequest,"jsonSchema"|"schemaName">, schema: z.ZodType<T>, opts?: {schemaName?: string}): Promise<{value: T; usage: LLMUsage}>` — derives JSON Schema via `z.toJSONSchema(schema)`; calls provider; validates `result.json` (falling back to parsing `result.text`); on validation failure, retries ONCE appending a user message: `"Your previous output failed validation: <zod issues>. Return ONLY corrected JSON matching the schema."`; second failure throws `StructuredOutputError` (exported) carrying both raw outputs. Usage in the return value is the SUM across attempts (metering must not lose the failed attempt).

- [ ] **Step 1: Failing test** — with `MockProvider`: (a) valid-first-try returns parsed value + usage; (b) invalid-then-valid: two calls, second request contains "failed validation" message, usage summed; (c) invalid-twice throws `StructuredOutputError`.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** (~50 lines; `z.toJSONSchema` is zod v4 — if the installed zod lacks it, add dev-verified conversion or upgrade zod; note in report).
- [ ] **Step 4: Verify pass. Commit** — `feat(llm): zod-validated structured completion with retry-on-invalid`

---

### Task 8: Settings store (keys, tier→model map, budget)

**Files:**
- Create: `src/lib/llm/settings.ts`
- Test: `src/lib/llm/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: `VaultStorage` (M1), Task 1 types
- Produces:
  - `interface LLMSettings { keys: Partial<Record<ProviderId, string>>; tierModels: Record<Tier, {provider: ProviderId; model: string}>; dailyBudgetUsd: number }`
  - `DEFAULT_SETTINGS: LLMSettings` — `fast: {provider:"anthropic", model:"claude-haiku-4-5"}`, `strong: {provider:"anthropic", model:"claude-opus-4-8"}`, `dailyBudgetUsd: 5`
  - `loadSettings(storage): Promise<LLMSettings>` (missing file/fields → defaults merged), `saveSettings(storage, settings): Promise<void>` — path `.scispark/settings.json`, merged non-destructively with any other keys already in that file
  - `buildProvider(settings, tier, fetchFn?): LLMProvider` — resolves tier → provider instance; throws `MissingKeyError` (exported) naming the provider when its key is absent

- [ ] **Step 1: Failing test** — defaults load on empty storage; save→load round-trip preserves unknown sibling keys in settings.json (write `{"other":1}` first, assert it survives); `buildProvider` returns AnthropicProvider for default fast tier when key present; throws `MissingKeyError("anthropic")` when absent.
- [ ] **Step 2–4: standard red/green.** Implementation is straightforward JSON merge over `storage.read/write`.
- [ ] **Step 5: Commit** — `feat(llm): settings store with tier→model mapping and BYOK keys`

---

### Task 9: Metering + daily budget

**Files:**
- Create: `src/lib/llm/metering.ts`
- Test: `src/lib/llm/__tests__/metering.test.ts`

**Interfaces:**
- Consumes: `VaultStorage`, pricing (Task 2)
- Produces:
  - `interface UsageRecord { ts: string; skill: string; runId: string; provider: ProviderId; model: string; usage: LLMUsage; costUsd: number | null }`
  - `class Meter { constructor(storage: VaultStorage, now?: () => Date); record(r: Omit<UsageRecord,"ts"|"costUsd">): Promise<UsageRecord>; spentTodayUsd(): Promise<number>; recordsForDay(date: string): Promise<UsageRecord[]> }` — appends JSONL to `.scispark/usage/YYYY-MM-DD.jsonl` (UTC date from injectable `now`); unknown-price models count as $0 in `spentTodayUsd` but keep `costUsd: null` in the record
  - `class BudgetExceededError extends Error { constructor(public spentUsd: number, public budgetUsd: number) }`
  - `checkBudget(meter, settings, estimatedNextCallUsd?: number): Promise<void>` — throws `BudgetExceededError` when `spentToday + (estimate ?? 0) >= dailyBudgetUsd`

- [ ] **Step 1: Failing test** — record two calls (haiku pricing) → `spentTodayUsd` matches sum; records land in the correct day file (inject `now`); day rollover isolates spend; `checkBudget` passes under budget, throws at/over; unknown-model record → `costUsd: null`, spend unchanged.
- [ ] **Step 2–4: red/green.** JSONL append = read existing + append line + write (single-writer per M1 changeset serialization convention; note comment).
- [ ] **Step 5: Commit** — `feat(llm): usage metering and daily budget enforcement`

---

### Task 10: Skill runner

**Files:**
- Create: `src/lib/skills/types.ts`, `src/lib/skills/runner.ts`
- Test: `src/lib/skills/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `interface SkillDefinition<I, O> { name: string; version: string; run(ctx: SkillContext, input: I): Promise<O> }` + `defineSkill<I, O>(def): SkillDefinition<I, O>` (identity with type inference)
  - `interface SkillContext { llm(tier: Tier, req: Omit<LLMRequest,"jsonSchema"|"schemaName">): Promise<LLMResult>; llmStructured<T>(tier: Tier, req: …, schema: z.ZodType<T>): Promise<T>; log(msg: string): void }`
  - `interface SkillRunResult<O> { runId: string; skill: string; status: "ok" | "error" | "budget_exceeded"; output?: O; error?: string; usage: LLMUsage; costUsd: number; logs: string[] }`
  - `runSkill<I, O>(opts: { skill: SkillDefinition<I,O>; input: I; storage: VaultStorage; settings?: LLMSettings; providerOverride?: Partial<Record<Tier, LLMProvider>>; now?: () => Date }): Promise<SkillRunResult<O>>` — builds ctx; every `ctx.llm*` call: `checkBudget` → `withRetry(provider.complete)` → `meter.record` (attributed to skill+runId); aggregates usage/cost; catches `BudgetExceededError` → status `"budget_exceeded"`; other errors → `"error"` with message; persists the run record JSON to `.scispark/runs/<runId>.json`. `providerOverride` is the test seam (and later the harness's model-override hook).
  - `runId` format: `run-<epochms>-<4 hex>` via injectable `now` + `Math.random` — acceptable here (not a changeset).

- [ ] **Step 1: Failing test** — with MockProvider overrides + MemoryVaultStorage:
  (a) happy path: skill makes one fast + one strong call, returns output; result status ok, usage aggregated, run record persisted, meter has 2 records attributed to skill name;
  (b) budget: settings dailyBudgetUsd tiny + pre-recorded spend → status `"budget_exceeded"`, no provider call made;
  (c) provider throws non-retryable → status `"error"`, error message captured, usage from calls before the failure still metered;
  (d) `ctx.llmStructured` returns validated value (schema via zod).
- [ ] **Step 2–4: red/green.**
- [ ] **Step 5: Commit** — `feat(skills): skill runner with budget enforcement, metering, run records`

---

### Task 11: /debug/llm verification page

**Files:**
- Create: `src/app/debug/llm/page.tsx`

**Interfaces:**
- Consumes: settings, providers, runner, meter, `getVault()` (M1)
- Produces: a `"use client"` page with: (1) key inputs per provider + tier→model editors + budget input, backed by `loadSettings`/`saveSettings`; (2) "Test completion" button running a trivial inline skill (`defineSkill` + `runSkill`) on the fast tier ("Reply with exactly: pong"); (3) "Test structured" button using a small zod schema ({answer: string, confidence: number}); (4) a panel showing the last run's usage/cost/status and `spentTodayUsd`. This is M2's manual verification gate with a real key.

- [ ] **Step 1: Implement the page** (plain HTML controls, monospace styling like /debug/vault; no design work). All state via React `useState` + the storage-backed settings; no new stores.
- [ ] **Step 2: Verify** — `npm test`, `npx tsc --noEmit`, `npm run lint --if-present` clean; dev server serves `/debug/llm` (HTTP 200). If a browser tool + a real API key are available, run the two buttons and confirm usage/cost render and `.scispark/usage/` gains records; otherwise report DONE_WITH_CONCERNS naming the interactive gate for Tong.
- [ ] **Step 3: Commit** — `feat(llm): /debug/llm harness verification page`

---

## Self-Review Notes

- **Spec coverage (M2 slice of docs/design/04):** providers Anthropic/OpenAI/Google/OpenRouter ✓ (Tasks 4–6), tier abstraction ✓ (1, 8), structured output + retry ✓ (7), metering + visible cost + daily budget with graceful degradation ✓ (9, 10 — degradation = `budget_exceeded` status callers render; the "fewer candidates" behavior is skill-level, arrives with the Feed Skill in M5), skill-runner primitives ✓ (10), BYOK privacy ✓ (keys only in `.scispark/settings.json`). Deferred per design: Ollama (v1.5), persona layer (M7), tool registry with vault.propose_changeset wiring (M4 — first vault-mutating skill), companion budget knobs (M7), "AI spend" full panel UI (M5 polish; /debug/llm shows the numbers).
- **Type consistency:** `LLMUsage`/`LLMResult`/`Tier`/`ProviderId` defined once (Task 1); `Meter.record` signature matches runner usage; `buildProvider` consumed by runner via settings unless `providerOverride`.
- **Known risks:** OpenAI/Google/OpenRouter API drift (mitigated by mandatory doc verification pre-steps); zod v4 `z.toJSONSchema` availability (Task 7 notes fallback); browser CORS for Google/OpenAI BYOK — if a provider blocks browser calls, the provider still works in tests and the report must flag it for a proxy-relay decision in M3 scope (do NOT silently route through our server).
