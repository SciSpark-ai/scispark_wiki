import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { searchIntentSkill, type SearchIntent } from "../search-intent"
import { runSkill } from "../runner"

/**
 * LIVE end-to-end gate for the Search-Intent Skill: real `fast`-tier calls
 * against a real LLM assert that a plain topical query classifies as
 * RELEVANCE while an explicitly recency-worded query classifies as DATE.
 * Skipped unless all three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/skills/__tests__/live-search-intent.test.ts
 *
 * Makes real network calls and spends real (tiny) money — never runs in CI.
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
const LIVE_TIMEOUT = 120_000

function liveSettings() {
  return {
    ...DEFAULT_SETTINGS,
    keys: { openai: API_KEY as string },
    baseUrls: { openai: BASE_URL as string },
    tierModels: {
      fast: { provider: "openai" as const, model: MODEL as string },
      strong: { provider: "openai" as const, model: MODEL as string },
    },
    dailyBudgetUsd: 5,
  }
}

async function classify(query: string): Promise<SearchIntent> {
  const run = await runSkill({
    skill: searchIntentSkill,
    input: { query },
    storage: new MemoryVaultStorage(),
    settings: liveSettings(),
  })
  console.log(`[live-search-intent] "${query}" -> status=${run.status} out=${JSON.stringify(run.output)} cost=$${(run.costUsd?.toFixed(5) ?? "unknown")}`)
  if (run.status !== "ok") console.log(`[live-search-intent] error: ${run.error}`)
  expect(run.status).toBe("ok")
  return run.output as SearchIntent
}

describe.skipIf(!live)("LIVE search-intent gate", () => {
  it(
    "classifies a plain topical query as relevance",
    { timeout: LIVE_TIMEOUT },
    async () => {
      expect((await classify("auditory attention decoding EEG")).sort).toBe("relevance")
    },
  )

  it(
    "classifies an explicitly recency-worded query as date",
    { timeout: LIVE_TIMEOUT },
    async () => {
      expect((await classify("latest diffusion model papers this year")).sort).toBe("date")
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live search-intent gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
