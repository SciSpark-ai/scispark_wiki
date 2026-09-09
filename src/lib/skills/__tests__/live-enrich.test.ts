import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import type { PaperRecord } from "../../papers/types"
import { enrichSkill, type EnrichResult } from "../enrich"
import { runSkill } from "../runner"

/**
 * LIVE end-to-end gate for the Enrich Skill: a real `fast`-tier structured
 * call against a real LLM, over a small paper record + wiki index, asserts a
 * non-empty tldr and a non-empty tags array come back.
 * Skipped unless all three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/skills/__tests__/live-enrich.test.ts
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

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG for Auditory Attention Decoding",
  abstract:
    "We present a low-profile ear-EEG system that decodes auditory attention from a listener's brain activity, enabling attention-steered hearing devices.",
  authors: [{ name: "A. Researcher" }, { name: "B. Researcher" }],
  year: 2024,
  venue: "arXiv",
  fields: ["eess.SP"],
  source: "arxiv",
}

const WIKI_INDEX = [
  { id: "concepts/auditory-attention", title: "Auditory Attention", type: "concept" },
  { id: "methods/ear-eeg", title: "Ear-EEG", type: "method" },
]

async function enrich(): Promise<EnrichResult> {
  const run = await runSkill({
    skill: enrichSkill,
    input: { paper: PAPER, wikiIndex: WIKI_INDEX },
    storage: new MemoryVaultStorage(),
    settings: liveSettings(),
  })
  console.log(`[live-enrich] status=${run.status} out=${JSON.stringify(run.output)} cost=$${(run.costUsd?.toFixed(5) ?? "unknown")}`)
  if (run.status !== "ok") console.log(`[live-enrich] error: ${run.error}`)
  expect(run.status).toBe("ok")
  return run.output as EnrichResult
}

describe.skipIf(!live)("LIVE enrich gate", () => {
  it(
    "returns a non-empty tldr and a non-empty tags array for a real paper",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const result = await enrich()
      expect(result.tldr.length).toBeGreaterThan(0)
      expect(Array.isArray(result.tags)).toBe(true)
      expect(result.tags.length).toBeGreaterThan(0)
      expect(Array.isArray(result.relatedPageIds)).toBe(true)
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live enrich gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
