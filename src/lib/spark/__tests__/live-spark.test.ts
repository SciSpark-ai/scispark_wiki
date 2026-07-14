import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { loadBundle } from "../../vault/bundle"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { searchArxiv } from "../../papers/arxiv"
import { searchOpenAlex } from "../../papers/openalex"
import { buildPaperPage, composePage } from "../../wiki/authoring"
import type { Frontmatter } from "../../vault/types"
import type { PaperRecord } from "../../papers/types"
import { runQuickSpark } from "../quick"
import { runDeepSpark, type DeepSparkResult } from "../deep"
import type { SearchFn } from "../grounding"

/**
 * LIVE end-to-end gate for M9: a real Quick Spark run (single strong-tier
 * call, vault-only) and a real Deep Spark run (grounding -> bottleneck ->
 * ideation -> scoop-check -> audit -> idea page) against real arXiv/OpenAlex
 * search and a real LLM, over an in-memory vault seeded with a small
 * "efficient long-context attention" neighborhood. Skipped unless all three
 * env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/spark/__tests__/live-spark.test.ts
 *
 * Makes real network calls (arXiv + OpenAlex + the LLM endpoint) and spends
 * real money — Deep Spark alone runs 5-9 strong-tier calls — never runs in
 * CI. Per M9 design (docs/superpowers/plans/2026-07-13-m9-spark.md Task 9),
 * these schemas use only enums/arrays/strings (no numeric-constraint zod
 * keywords), so the M5 live gate's GMI structured-output constraint-keyword
 * stripping suffices here too; if the intermittent whole-`output_config`
 * flake noted there appears, that's GMI backend-replica variance, not a
 * defect in this code — record it, don't chase it.
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
// Deep Spark runs 5-9 strong-tier calls across its phase graph (bottleneck,
// ideation, scoop-terms, scoop-verdict, audit — possibly twice on a retry);
// budget generously.
const LIVE_TIMEOUT = 300_000

/**
 * Node relay-free SearchFn: calls the M3 search-core adapters (searchArxiv,
 * searchOpenAlex) directly — no HTTP server, no /api/search proxy. s2/pubmed
 * queries are remapped onto openalex so Deep Spark's grounding retrieval is
 * exercised without hitting sources that need API keys or are prone to live
 * rate-limit flakes. A failed query resolves to [] (per the SearchFn
 * contract) rather than failing the whole run. Mirrors the M5 live gate's
 * nodeSearchFn (src/lib/skills/__tests__/live-feed.test.ts).
 */
function nodeSearchFn(): SearchFn {
  const mailto = process.env.OPENALEX_MAILTO
  return async (source, query, limit) => {
    const effectiveSource = source === "s2" || source === "pubmed" ? "openalex" : source
    try {
      if (effectiveSource === "arxiv") {
        return await searchArxiv({ query, limit })
      }
      return await searchOpenAlex({ query, limit }, { mailto })
    } catch (err) {
      console.warn(`[live-spark] search failed for source=${source} query="${query}":`, err)
      return []
    }
  }
}

const DIRECTION = "efficient long-context attention"
const TODAY = "2026-07-13"

/** Seeds a small (3-page) vault neighborhood on the DIRECTION so both Quick's
 * token-overlap search and Deep's grounding warm-start have something real to
 * find. Two concept pages (written directly, mirroring quick.test.ts's/
 * deep.test.ts's `writePage` helper) plus one deterministic paper page via
 * `buildPaperPage` — exercising the actual builder the brief calls out. */
async function seedVault(storage: MemoryVaultStorage): Promise<void> {
  await createVault(storage, { purpose: "Track research on efficient long-context attention.", today: TODAY })

  const conceptFrontmatter = (title: string): Frontmatter => ({
    type: "concept",
    title,
    created: TODAY,
    updated: TODAY,
    tags: ["long-context", "attention"],
    related: [],
    sources: [],
  })

  await storage.write(
    "wiki/concepts/sparse-attention.md",
    composePage({
      path: "wiki/concepts/sparse-attention.md",
      frontmatter: conceptFrontmatter("Sparse Attention"),
      body:
        "# Sparse Attention\n\nRestricts each query to attend to a subset of keys (local windows, " +
        "strided patterns, or learned routing) instead of the full sequence, cutting the " +
        "quadratic attention cost for long-context transformers.\n",
    }),
  )

  await storage.write(
    "wiki/concepts/kv-cache-compression.md",
    composePage({
      path: "wiki/concepts/kv-cache-compression.md",
      frontmatter: conceptFrontmatter("KV Cache Compression"),
      body:
        "# KV Cache Compression\n\nReduces the memory footprint of the key/value cache during " +
        "long-context autoregressive decoding via quantization, low-rank projection, or " +
        "eviction of low-salience tokens.\n",
    }),
  )

  const paper: PaperRecord = {
    ids: { arxiv: "2307.14995" },
    title: "Efficient Long-Context Attention via Sparse and Cached Key-Value Routing",
    abstract:
      "We study efficient attention mechanisms for long-context transformers, combining sparse " +
      "attention patterns with key-value cache compression to reduce both compute and memory " +
      "at long sequence lengths.",
    authors: [{ name: "A. Researcher" }],
    year: 2023,
    venue: "arXiv preprint",
    fields: ["cs.LG"],
    source: "arxiv",
  }
  const paperDraft = buildPaperPage(paper, { fullText: false, today: TODAY, sources: ["arxiv:2307.14995"] })
  await storage.write(paperDraft.path, composePage(paperDraft))
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

describe.skipIf(!live)("LIVE Spark gate (Quick + Deep)", () => {
  it(
    "runQuickSpark against a real LLM: >=1 seed, each with a hook and a real grounding page id",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()
      await seedVault(storage)

      const result = await runQuickSpark(storage, {
        direction: DIRECTION,
        settings: liveSettings(),
      })

      console.log(`[live-spark] quick seeds: ${JSON.stringify(result.seeds, null, 2)}`)
      console.log(`[live-spark] quick costUsd: $${result.costUsd.toFixed(4)}`)

      expect(result.seeds.length).toBeGreaterThanOrEqual(1)

      const bundle = await loadBundle(storage)
      for (const seed of result.seeds) {
        expect(seed.hook.trim().length).toBeGreaterThan(0)
        expect(seed.groundingPageIds.length).toBeGreaterThanOrEqual(1)
        for (const pageId of seed.groundingPageIds) {
          expect(bundle.pages.has(pageId)).toBe(true)
        }
      }

      expect(result.costUsd).toBeLessThan(0.15)
    },
  )

  it(
    "runDeepSpark against real search + a real LLM: a valid outcome, and a parseable idea page when accepted",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()
      await seedVault(storage)

      const phases: string[] = []
      const result: DeepSparkResult = await runDeepSpark({
        storage,
        direction: DIRECTION,
        searchFn: nodeSearchFn(),
        settings: liveSettings(),
        today: TODAY,
        onPhase: (p) => phases.push(p),
      })

      console.log(`[live-spark] deep phases: ${phases.join(" -> ")}`)
      console.log(`[live-spark] deep outcome: ${JSON.stringify(result.outcome)}`)
      console.log(`[live-spark] deep phaseCosts: ${JSON.stringify(result.phaseCosts)}`)
      console.log(`[live-spark] deep costUsd: $${result.costUsd.toFixed(4)}`)

      expect(["idea", "do_not_generate", "abandoned"]).toContain(result.outcome.kind)

      if (result.outcome.kind === "idea") {
        const bundle = await loadBundle(storage)
        expect(bundle.errors).toEqual([])
        const page = bundle.pages.get(result.outcome.ideaPageId)
        expect(page).toBeDefined()
        expect(page!.frontmatter.type).toBe("idea")

        console.log(`[live-spark] sample idea title: ${String(page!.frontmatter.title)}`)

        // All four falsification fields (assembleIdeaBody's "## Falsification Plan"
        // section, src/lib/spark/assemble.ts's renderFalsification) plus a scoop
        // verdict ("## Scoop Check" -> "**Verdict:**", renderScoopCheck) must be
        // present in the written body.
        expect(page!.body).toContain("**Hypothesis:**")
        expect(page!.body).toContain("**Prediction:**")
        expect(page!.body).toContain("**Kill criterion:**")
        expect(page!.body).toContain("**Experiment:**")
        expect(page!.body).toContain("**Verdict:**")
      }

      expect(result.costUsd).toBeLessThan(4)
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live spark gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
