import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { loadChangeset } from "../../vault/changesets"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { nodeFeedSearchFn } from "../../papers/node-search"
import { seedUserModel, USER_MODEL_PATHS } from "../../usermodel/pages"
import { logEvent } from "../../events/log"
import { runFeed, loadFeed, FEED_CACHE_PATH } from "../feed"
import { runConsolidation } from "../consolidation"

/**
 * LIVE end-to-end gate for M5: a real personalized feed run (strategy ->
 * retrieve -> assess -> diversify) against real scholarly sources and a real
 * LLM, followed by a forced Memory-Consolidation pass — all against an
 * in-memory vault. Skipped unless all three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/skills/__tests__/live-feed.test.ts
 *
 * Makes real network calls (arXiv + OpenAlex + the LLM endpoint) and spends
 * real (small) money — never runs in CI.
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
const LIVE_TIMEOUT = 240_000 // planning + batched assessment plus the separately gated legacy consolidation

describe.skipIf(!live)("LIVE feed funnel + consolidation gate", () => {
  it(
    "runFeed against real search + a real LLM, then a forced consolidation pass",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()
      const today = new Date().toISOString().slice(0, 10)
      await createVault(storage, {
        purpose: "Track research on computational biology and structural bioinformatics.",
        today,
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

      // ── Seed a realistic computational-biology user model ────────────────
      await seedUserModel(storage, {
        name: "Ada",
        role: "PhD student in computational biology, working on protein structure prediction and single-cell genomics.",
        fields: "Computational biology, structural bioinformatics, machine learning for genomics.",
        topics:
          "protein structure prediction\nsingle-cell RNA-seq analysis\ngraph neural networks for molecular biology\nprotein language models",
        feedPrefs:
          "Prioritize methods papers with open-source code; include some cross-disciplinary ML-for-science papers; skip pure clinical trials.",
      })

      // ── ~10 synthetic Tier-1 events with realistic titles ────────────────
      await logEvent(storage, {
        type: "ingest",
        paperKey: "arxiv:2107.11040",
        title: "ESM-2: Language models of protein sequences at the scale of evolution",
        changesetId: "cs-seed-0001",
      })
      await logEvent(storage, {
        type: "ingest",
        paperKey: "arxiv:2003.13845",
        title: "AlphaFold2: Highly accurate protein structure prediction with deep learning",
        changesetId: "cs-seed-0002",
      })
      await logEvent(storage, {
        type: "paper_view",
        paperKey: "arxiv:2110.05006",
        title: "Single-cell RNA-seq clustering with variational autoencoders",
      })
      await logEvent(storage, {
        type: "paper_view",
        paperKey: "arxiv:2003.06902",
        title: "Graph neural networks for molecular property prediction",
      })
      await logEvent(storage, {
        type: "paper_view",
        paperKey: "arxiv:2205.15019",
        title: "Diffusion models for de novo protein design",
      })
      await logEvent(storage, {
        type: "feed_dismiss",
        paperKey: "arxiv:2401.00001",
        title: "A survey of deep learning applications in radiology",
      })
      await logEvent(storage, {
        type: "feed_save",
        paperKey: "arxiv:2205.11189",
        title: "Protein language models for variant effect prediction",
      })
      await logEvent(storage, {
        type: "feed_save",
        paperKey: "arxiv:2306.15912",
        title: "Benchmarking foundation models on genomics tasks",
      })
      await logEvent(storage, { type: "search", source: "arxiv", query: "protein structure prediction transformer" })
      await logEvent(storage, {
        type: "digest_generated",
        paperKey: "arxiv:2107.11040",
        title: "ESM-2: Language models of protein sequences at the scale of evolution",
        costUsd: 0.03,
      })

      // ── runFeed against real search + a real LLM ─────────────────────────
      const feedResult = await runFeed(storage, {
        searchFn: nodeFeedSearchFn(),
        settings,
      })

      console.log(
        `[live-feed] strategy queries: ${JSON.stringify(feedResult.strategy.queries.map((q) => ({ source: q.source, query: q.query })))}`,
      )
      console.log(
        `[live-feed] stats: retrieved=${feedResult.stats.retrieved} ranked=${feedResult.stats.ranked} items=${feedResult.items.length}`,
      )
      console.log(
        `[live-feed] items:\n${feedResult.items
          .map((i) => `  [${i.score}] ${i.paper.title} — topics: ${i.ranking?.matchedTopics.join(", ")}`)
          .join("\n")}`,
      )

      expect(feedResult.items.length).toBeGreaterThanOrEqual(5)

      for (const item of feedResult.items) {
        expect(item.ranking?.relevance).toBeGreaterThanOrEqual(50)
        expect(item.ranking?.total).not.toBeNull()
        expect(item.whyThis).toBe("")
        expect(item.paper.title.trim().length).toBeGreaterThan(0)
        const hasId = Object.values(item.paper.ids).some((v) => typeof v === "string" && v.length > 0)
        expect(hasId || item.paper.year !== undefined).toBe(true)
      }

      console.log(`[live-feed] feed costUsd: $${feedResult.costUsd.toFixed(4)}`)
      expect(feedResult.costUsd).toBeLessThan(1.5)

      // ── Cache written and round-trips ────────────────────────────────────
      const cached = await storage.read(FEED_CACHE_PATH)
      expect(cached).not.toBeNull()
      const loaded = await loadFeed(storage)
      expect(loaded).toEqual(feedResult)

      // ── Forced Memory-Consolidation pass ─────────────────────────────────
      const consolidation = await runConsolidation(storage, { force: true, settings })
      console.log(
        `[live-feed] consolidation: status=${consolidation.status} changesetId=${consolidation.changesetId} costUsd=${consolidation.costUsd}`,
      )
      expect(["applied", "unchanged"]).toContain(consolidation.status)

      if (consolidation.status === "applied") {
        const interests = (await storage.read(USER_MODEL_PATHS.interests)) as string
        // At least one seeded topic word must survive — no wholesale hallucinated replacement.
        expect(interests.toLowerCase()).toMatch(/protein|genomics|genom|molecular/)

        expect(consolidation.changesetId).toBeDefined()
        const changeset = await loadChangeset(storage, consolidation.changesetId as string)
        expect(changeset).not.toBeNull()
      }
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live feed gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
