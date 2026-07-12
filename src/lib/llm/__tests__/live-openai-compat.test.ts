import { describe, it, expect } from "vitest"
import { z } from "zod"
import { OpenAICompatProvider } from "../providers/openai-compat"
import { completeStructured } from "../structured"
import { DEFAULT_SETTINGS } from "../settings"
import { runSkill } from "../../skills/runner"
import { defineSkill } from "../../skills/types"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { Meter } from "../metering"

/**
 * LIVE end-to-end gate for the M2 harness against any OpenAI-compatible
 * endpoint (BYOK). Skipped unless all three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_API_KEY=... \
 *   LIVE_LLM_MODEL=claude-sonnet-5 \
 *   npx vitest run src/lib/llm/__tests__/live-openai-compat.test.ts
 *
 * Makes real network calls and spends real (tiny) money — never runs in CI.
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
const LIVE_TIMEOUT = 120_000 // reasoning models can think for a while

describe.skipIf(!live)("LIVE openai-compatible endpoint", () => {
  const provider = () =>
    new OpenAICompatProvider("openai", API_KEY as string, (BASE_URL as string).replace(/\/+$/, ""))

  it("plain completion answers", { timeout: LIVE_TIMEOUT }, async () => {
    const result = await provider().complete(MODEL as string, {
      messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
      maxTokens: 4096, // headroom: reasoning models may spend tokens thinking
    })
     
    console.log("[live] plain:", JSON.stringify({ text: result.text.slice(0, 120), usage: result.usage, model: result.model, stopReason: result.stopReason }))
    expect(result.text.toLowerCase()).toContain("pong")
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  })

  it("structured completion validates against a zod schema", { timeout: LIVE_TIMEOUT }, async () => {
    const schema = z.object({ answer: z.string(), confidence: z.number() })
    const { value, usage } = await completeStructured(
      provider(),
      MODEL as string,
      {
        messages: [
          {
            role: "user",
            content:
              'Is water wet? Respond ONLY with a JSON object: {"answer": <short string>, "confidence": <number 0..1>}',
          },
        ],
        maxTokens: 4096,
      },
      schema,
      { schemaName: "wetness" },
    )
     
    console.log("[live] structured:", JSON.stringify({ value, usage }))
    expect(typeof value.answer).toBe("string")
    expect(value.confidence).toBeGreaterThanOrEqual(0)
    expect(value.confidence).toBeLessThanOrEqual(1)
  })

  it("full skill run: budget check, retry wrapper, metering, run record", { timeout: LIVE_TIMEOUT }, async () => {
    const storage = new MemoryVaultStorage()
    const skill = defineSkill<{ q: string }, string>({
      name: "live-gate",
      version: "1",
      run: async (ctx, input) => {
        const r = await ctx.llm("fast", {
          messages: [{ role: "user", content: input.q }],
          maxTokens: 4096,
        })
        return r.text
      },
    })
    const settings = {
      ...DEFAULT_SETTINGS,
      keys: { openai: API_KEY as string },
      baseUrls: { openai: BASE_URL as string },
      tierModels: {
        fast: { provider: "openai" as const, model: MODEL as string },
        strong: { provider: "openai" as const, model: MODEL as string },
      },
      dailyBudgetUsd: 5,
    }
    const result = await runSkill({ skill, input: { q: "Reply with exactly one word: pong" }, storage, settings })
     
    console.log("[live] runSkill:", JSON.stringify({ status: result.status, usage: result.usage, costUsd: result.costUsd, error: result.error }))
    expect(result.status).toBe("ok")
    expect((result.output ?? "").toLowerCase()).toContain("pong")
    expect(result.usage.outputTokens).toBeGreaterThan(0)

    const meter = new Meter(storage)
    const today = new Date().toISOString().slice(0, 10)
    const records = await meter.recordsForDay(today)
    expect(records).toHaveLength(1)
    expect(records[0].skill).toBe("live-gate")
    expect(records[0].model).toBe(MODEL)

    const runFiles = await storage.list(".scispark/runs/")
    expect(runFiles).toHaveLength(1)
  })
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
