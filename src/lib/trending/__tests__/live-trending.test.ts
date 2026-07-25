import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { searchArxiv } from "../../papers/arxiv"
import { searchOpenAlex } from "../../papers/openalex"
import { nodeCountFn, nodeTopicGroupFn, nodeTopicFieldGroupFn } from "../../papers/node-search"
import { readRecentEvents } from "../../events/log"
import { runTrendingBoard, TRENDING_BOARD_VERSION } from "../dashboard"
import { TopicBriefsSchema } from "../../skills/trending"
import { MIN_RECENT_COUNT } from "../topics"
import type { SearchFn } from "../../skills/feed"

/**
 * LIVE end-to-end gate for the trending board (M10 → SP4): a real board
 * refresh seeded from one interest label ("Natural Language Processing")
 * against real OpenAlex `group_by` ranking, real arXiv/OpenAlex search, and a
 * real LLM (the persona-free `trendingSkill`, one strong-tier structured call
 * per anchor discipline). Mirrors the M9 live-gate idiom
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
 *
 * Wires a real `countFn` (countOpenAlexWorks — keyless, no LLM key needed) so
 * the run exercises real OpenAlex work counts: one prior-window lookup per
 * candidate topic (the growth column AND the row's before/after bars) plus the
 * anchor-wide recent totals. There is no per-week series any more — the
 * `group_by=publication_date` request it relied on is rejected by OpenAlex.
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

describe.skipIf(!live)("LIVE trending board gate", () => {
  it(
    "runTrendingBoard for one interest label against real OpenAlex group_by + search + a real LLM: real anchors, real growth numbers and prior counts, schema-valid (or gracefully degraded) briefs, bounded cost",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()

      const board = await runTrendingBoard(storage, {
        fields: [FIELD],
        searchFn: nodeSearchFn(),
        // The PRODUCTION node groupers/counters, so this run exercises exactly
        // the wiring the trending routes use: one group_by=primary_topic.id
        // request per anchor for the leaderboard, one
        // group_by=primary_topic.field.id per label for anchor derivation, and
        // one filtered count per candidate for its true prior-window figure.
        countFn: nodeCountFn(),
        topicGroupFn: nodeTopicGroupFn(),
        fieldGroupFn: nodeTopicFieldGroupFn(),
        settings: liveSettings(),
        now: () => new Date(),
      })

      expect(board.version).toBe(TRENDING_BOARD_VERSION)
      expect(board.anchors.length).toBeGreaterThan(0)
      console.log("[live-trending] anchors:", JSON.stringify(board.anchors))
      console.log("[live-trending] overview:", JSON.stringify(board.overview))

      // Real, deterministic ranking: at least one topic cleared the volume
      // floor, and every number came from OpenAlex counts.
      expect(board.topics.length).toBeGreaterThan(0)
      const top = board.topics[0]
      console.log(
        "[live-trending] top topic:",
        JSON.stringify({ label: top.label, discipline: top.discipline, growth: top.growth, recentCount: top.recentCount }),
      )
      expect(top.recentCount).toBeGreaterThanOrEqual(MIN_RECENT_COUNT)
      expect(board.overview.totalRecent).toBeGreaterThan(0)

      // The bars are drawn from the same measured counts as the badge, so the
      // prior figure must be a real, finite number on every row.
      expect(board.topics.every((t) => Number.isFinite(t.priorCount) && t.priorCount >= 0)).toBe(true)
      console.log("[live-trending] top prior/recent:", top.priorCount, "→", top.recentCount)

      if (board.surveyError) {
        // Acceptable for the gate (GMI backend-replica flake etc.) as long as
        // the failure surfaces its real reason rather than silently vanishing.
        console.log("[live-trending] survey unavailable, error:", board.surveyError)
        expect(board.topics.every((t) => t.why === null)).toBe(true)
      } else {
        // Schema-valid briefs are the expected happy path, joined by key.
        expect(board.topics.some((t) => t.why !== null)).toBe(true)
        expect(
          TopicBriefsSchema.safeParse({
            topics: board.topics.filter((t) => t.why !== null).map((t) => ({ key: t.key, why: t.why as string })),
            crossDisciplineNote: board.crossDisciplineNote ?? "n/a",
          }).success,
        ).toBe(true)
        console.log("[live-trending] sample topic brief:", board.topics.find((t) => t.why)?.why)
      }

      // runTrendingBoard doesn't return cost directly (TrendingBoard has no
      // costUsd field) — the accumulated cost is logged onto the
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
