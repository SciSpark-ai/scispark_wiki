import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { readingCompanionSkill, type ReadingCompanionInput } from "../reading-companion"
import { runSkill } from "../runner"
import type { ReadingAnswer } from "../reading-companion"

/**
 * LIVE end-to-end gate for M6: a real Reading-Companion "select-to-ask" call
 * (a highlighted passage + surrounding text + paper metadata + one wiki
 * snippet + a concrete question) against a real LLM, over an in-memory vault.
 * Skipped unless all three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/skills/__tests__/live-reading-companion.test.ts
 *
 * Makes a real network call to the LLM endpoint and spends real (small)
 * money — never runs in CI.
 *
 * Note: `ReadingAnswerSchema` (src/lib/skills/reading-companion.ts) is built
 * entirely from `z.string()`/`z.array(z.string())` — no numeric/length
 * constraints — so it should pass GMI's strict structured-output backend
 * cleanly (the M5-discovered constraint-keyword stripping in
 * `OpenAICompatProvider` exists for schemas that DO carry such constraints;
 * it's a no-op here, but harmless either way). If the intermittent
 * whole-`output_config.format` replica flakiness seen elsewhere against GMI
 * shows up here too, that's a known live-backend quirk, not a code defect —
 * record it in the SDD ledger rather than treating it as a regression (see
 * the M6 plan's "provider prompt-JSON fallback" ride-along item).
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
const LIVE_TIMEOUT = 120_000

const PASSAGE =
  "To compute the output of this layer, we employ an attention function that maps a query " +
  "and a set of key-value pairs to an output, where the query, keys, values, and output " +
  "are all vectors. Instead of performing a single attention function, we found it " +
  "beneficial to linearly project the queries, keys, and values h times with different, " +
  "learned linear projections. On each of these projected versions we then perform the " +
  "attention function in parallel, yielding output values that are concatenated and once " +
  "again projected, resulting in the final values.\n\n" +
  "This multi-head attention allows the model to jointly attend to information from " +
  "different representation subspaces at different positions; with a single attention " +
  "head, averaging inhibits this. The dominant approach before this work relied on " +
  "recurrent or convolutional layers to relate signals from two arbitrary positions, " +
  "with the number of operations required growing with the distance between positions — " +
  "multi-head attention reduces this to a constant number of operations, at the cost of " +
  "reduced effective resolution due to averaging attention-weighted positions, an effect " +
  "we counteract with Multi-Head Attention."

const SURROUNDING =
  "Section 3.2: Attention. An attention function can be described as mapping a query and " +
  "a set of key-value pairs to an output. " +
  PASSAGE +
  " Section 3.3 describes the position-wise feed-forward networks that follow."

const PAPER_META =
  "Title: Attention Is All You Need\n" +
  "Authors: Ashish Vaswani, Noam Shazeer, Niki Parmar\n" +
  "Year: 2017\n" +
  "Abstract: We propose the Transformer, a network architecture based solely on attention " +
  "mechanisms, dispensing with recurrence and convolutions entirely."

const WIKI_NEIGHBORHOOD =
  "[[multi-head-attention]] (concept): Multi-head attention runs several scaled " +
  "dot-product attention operations in parallel over learned linear projections of the " +
  "queries, keys, and values, then concatenates and re-projects the results. This lets " +
  "the model attend to information from different representation subspaces at different " +
  "positions simultaneously, which a single attention head cannot do."

describe.skipIf(!live)("LIVE reading-companion gate", () => {
  it(
    "answers a grounded question about a selected passage, against a real LLM",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()

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

      const input: ReadingCompanionInput = {
        selection: PASSAGE,
        surrounding: SURROUNDING,
        paperMeta: PAPER_META,
        wikiNeighborhood: WIKI_NEIGHBORHOOD,
        userQuestion: "What problem does this passage say the method solves?",
      }

      const run = await runSkill({
        skill: readingCompanionSkill,
        input,
        storage,
        settings,
      })

      console.log(
        `[live-reading-companion] status=${run.status} costUsd=${run.costUsd} ` +
          `usage=${JSON.stringify(run.usage)} logs=${JSON.stringify(run.logs)}`,
      )
      if (run.status !== "ok") console.log(`[live-reading-companion] error: ${run.error}`)
      expect(run.status).toBe("ok")

      const output = run.output as ReadingAnswer
      console.log(`[live-reading-companion] answer: ${output.answer}`)
      console.log(`[live-reading-companion] citedPageIds: ${JSON.stringify(output.citedPageIds)}`)

      expect(output.answer.trim().length).toBeGreaterThan(0)
      expect(Array.isArray(output.citedPageIds)).toBe(true)
      // Loose grounding check: the answer should reference the passage's subject matter.
      expect(output.answer.toLowerCase()).toContain("attention")

      console.log(`[live-reading-companion] costUsd: $${run.costUsd.toFixed(4)}`)
      expect(run.costUsd).toBeLessThan(0.2)
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live reading-companion gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
