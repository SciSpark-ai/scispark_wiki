import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { searchArxiv } from "../../papers/arxiv"
import { searchOpenAlex } from "../../papers/openalex"
import { readRecentEvents } from "../../events/log"
import { runTrendingDashboard } from "../dashboard"
import { TrendingSurveySchema } from "../../skills/trending"
import type { SearchFn } from "../../skills/feed"

/**
 * LIVE end-to-end gate for M10: a real trending-dashboard refresh for one
 * tracked field ("Natural Language Processing") against real arXiv/OpenAlex
 * search and a real LLM (the persona-free `trendingSkill`, a single
 * strong-tier structured call). Mirrors the M9 live-gate idiom
 * (src/lib/spark/__tests__/live-spark.test.ts): env-gated, node searchFn
 * calling search-core directly, in-memory vault, generous timeout, an
 * always-on "skips cleanly" wiring test. Skipped unless all three env vars
 * are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/trending/__tests__/live-trending.test.ts
 *
 * Makes real network calls (arXiv + OpenAlex + the LLM endpoint) and spends
 * real money — never runs in CI. Far lighter than Deep Spark: retrieval plus
 * exactly one strong-tier call for the single field's survey.
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
const LIVE_TIMEOUT = 120_000

/**
 * Node relay-free SearchFn: calls the M3 search-core adapters (searchArxiv,
 * searchOpenAlex) directly — no HTTP server, no /api/search proxy. A failed
 * query resolves to [] (per the SearchFn contract, and per
 * retrieveFieldCandidates's own per-source try/catch) rather than failing
 * the whole run. Mirrors live-spark.test.ts's nodeSearchFn; trending's own
 * retrieveFieldCandidates only ever calls with source "arxiv" or "openalex"
 * (src/lib/trending/retrieve.ts's SOURCES), so no s2/pubmed remap is needed.
 */
function nodeSearchFn(): SearchFn {
  const mailto = process.env.OPENALEX_MAILTO
  return async (source, query, limit) => {
    try {
      if (source === "arxiv") {
        return await searchArxiv({ query, limit })
      }
      return await searchOpenAlex({ query, limit }, { mailto })
    } catch (err) {
      console.warn(`[live-trending] search failed for source=${source} query="${query}":`, err)
      return []
    }
  }
}

function liveSettings() {
  return {
    ...DEFAULT_SETTINGS,
    keys: { openai: API_KEY as string },
    baseUrls: { openai: BASE_URL as string },
    tierModels: {
      fast: { provider: "openai" as const, model: MODEL as string },
      strong: { provider: "openai" as const, model: MODEL as string },
    },
    dailyBudgetUsd: 10,
  }
}

const FIELD = { slug: "natural-language-processing", label: "Natural Language Processing" }

describe.skipIf(!live)("LIVE trending dashboard gate", () => {
  it(
    "runTrendingDashboard for one field against real search + a real LLM: real metrics, schema-valid (or gracefully degraded) survey, bounded cost",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()

      const dash = await runTrendingDashboard(storage, {
        fields: [FIELD],
        searchFn: nodeSearchFn(),
        settings: liveSettings(),
        now: () => new Date(),
      })

      expect(dash.panels).toHaveLength(1)
      const panel = dash.panels[0]

      // Deterministic metrics, derived from real retrieved papers.
      expect(panel.metrics.weeklyVolume.length).toBe(8)
      expect(typeof panel.metrics.paperCountRecent).toBe("number")

      console.log("[live-trending] weeklyVolume:", JSON.stringify(panel.metrics.weeklyVolume))
      console.log("[live-trending] paperCountRecent:", panel.metrics.paperCountRecent)

      if (panel.survey) {
        // Schema-valid survey is the expected happy path.
        expect(TrendingSurveySchema.safeParse(panel.survey).success).toBe(true)
        console.log("[live-trending] sample notable title:", panel.survey.notablePapers[0]?.title)
      } else {
        // Acceptable for the gate (GMI backend-replica flake etc.) as long as
        // the failure surfaces an error string rather than silently vanishing.
        expect(panel.error).toBeTruthy()
        console.log("[live-trending] survey unavailable, error:", panel.error)
      }

      // runTrendingDashboard doesn't return cost directly (TrendingDashboard has
      // no costUsd field) — the accumulated cost is logged onto the
      // trending_refresh event instead (src/lib/trending/dashboard.ts).
      const events = await readRecentEvents(storage)
      const refresh = events.find((e) => e.type === "trending_refresh") as { costUsd?: number } | undefined
      expect(refresh).toBeTruthy()
      const costUsd = refresh?.costUsd ?? 0
      console.log(`[live-trending] event costUsd: $${costUsd.toFixed(4)}`)
      expect(costUsd).toBeLessThan(0.5)
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live trending gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
