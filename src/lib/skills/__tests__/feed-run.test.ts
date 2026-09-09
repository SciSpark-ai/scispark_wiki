import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { readRecentEvents } from "../../events/log"
import type { PaperRecord } from "../../papers/types"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { runFeed, loadFeed, FEED_CACHE_PATH, type FeedStrategy } from "../feed"
import { FEEDBACK_PATH } from "../../recommendation/contract"
import { recordRecommendationFeedback } from "../../recommendation/feedback"
import { undoChangeset } from "../../vault/mutations"

const NOW = () => new Date("2026-07-12T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

function paper(overrides: Partial<PaperRecord> & { title: string }): PaperRecord {
  return {
    ids: {},
    authors: [],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

function llmResult(json: unknown, model: string, usage = { inputTokens: 500, outputTokens: 200 }): LLMResult {
  return {
    text: JSON.stringify(json),
    json,
    usage,
    model,
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

const ONE_QUERY_STRATEGY: FeedStrategy = {
  queries: [{ source: "arxiv", query: "sparse attention", rationale: "core interest" }],
}


const assessment = (index: number, grade = 4) => ({
  index, question: { grade, evidence: "Sparse attention" }, topic: { grade, evidence: "Sparse attention" },
  approach: { grade: null, evidence: "" }, matches: [{ topic: "sparse attention", evidence: "Sparse attention" }], excluded: false,
})
const candidates = (count = 3) => Array.from({ length: count }, (_, i) => paper({
  title: `Sparse attention study ${i}`, ids: { arxiv: String(i) }, date: "2026-07-12",
  abstract: "Sparse attention methods evaluated in transformer models.", venue: "Hidden venue",
}))
async function vault() {
  const storage = new MemoryVaultStorage()
  await storage.write("profile.md", "# Profile\n\n## Research fields\n\n- machine learning\n")
  await storage.write("interests.md", "# Interests\n\n## Active topics\n\n- sparse attention\n")
  return storage
}
function providers(grades = [4, 1, 3]) {
  return {
    strong: new MockProvider([llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8")]),
    fast: new MockProvider([llmResult({ assessments: grades.map((grade, i) => assessment(i, grade)) }, "claude-haiku-4-5")]),
  }
}

describe("runFeed weighted pipeline", () => {
  it.each([false, true])("honors enabled sources even when the model proposes only disabled sources (planner failure=%s)", async (fails) => {
    const storage = await vault(), p = providers([4]), seen: string[] = []
    await storage.write(".scispark/settings.json", JSON.stringify({ paperSources: { enabledSources: ["pubmed"] } }))
    if (fails) p.strong = new MockProvider([])
    const result = await runFeed(storage, {
      searchFn: async (source) => { seen.push(source); return candidates(1) },
      settings: settingsWithKeys(), providerOverride: p, now: NOW,
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(new Set(seen)).toEqual(new Set(["pubmed"]))
    expect(result.strategy.queries.every((query) => query.source === "pubmed")).toBe(true)
    if (!fails) expect(p.strong.calls[0].req.messages[0].content).toContain("Only use these enabled sources: pubmed")
  })
  it("drops disabled sources from a mixed model plan", async () => {
    const storage = await vault(), p = providers([4]), seen: string[] = []
    await storage.write(".scispark/settings.json", JSON.stringify({ paperSources: { enabledSources: ["arxiv", "pubmed"] } }))
    p.strong = new MockProvider([llmResult({ queries: [...ONE_QUERY_STRATEGY.queries, { source: "s2", query: "attention", rationale: "forbidden source" }] }, "claude-opus-4-8")])
    await runFeed(storage, { searchFn: async (source) => { seen.push(source); return candidates(1) }, settings: settingsWithKeys(), providerOverride: p, now: NOW })
    expect(new Set(seen)).toEqual(new Set(["arxiv"]))
  })
  it("completes a first feed when source records explicitly contain missing optional IDs", async () => {
    const storage = await vault()
    const result = await runFeed(storage, {
      searchFn: async () => candidates(1).map((paper) => ({ ...paper, ids: { ...paper.ids, doi: undefined, pmid: undefined } })),
      settings: settingsWithKeys(), providerOverride: providers([4]), now: NOW,
    })
    expect(result.items).toHaveLength(1)
    expect(result.recommendation?.status).toBe("ranked")
    expect((await loadFeed(storage))?.items).toHaveLength(1)
  })
  it("reads persisted Sparky reasons into both next search planning and candidate assessment", async () => {
    const storage = await vault()
    await storage.write(FEEDBACK_PATH, JSON.stringify({ version: 1, entries: [{ paperKey: "doi:old-feedback", title: "Sparse attention methods", abstract: "Sparse attention in simulation.", topics: ["sparse attention"], reason: "wrong_method", note: "I need empirical evaluations, not simulation alone.", at: NOW().toISOString() }] }))
    const p = providers([4])
    const result = await runFeed(storage, { searchFn: async () => candidates(1), settings: settingsWithKeys(), providerOverride: p, now: NOW })
    expect(p.strong.calls[0].req.messages[1].content).toContain("I need empirical evaluations")
    expect(p.fast.calls[0].req.messages[1].content).toContain("I need empirical evaluations")
    expect(result.recommendation?.memoryPaperKeys).toEqual(["doi:old-feedback"])
    expect(result.recommendation?.memoryStatus).toBe("incomplete")
    expect(result.recommendation?.warnings.join(" ")).toContain("preference matches were missing")
    await storage.write("profile.md", (await storage.read("profile.md")) + '\n## Recommendation settings\n{"learnFromFeedback":false}\n')
    const disabled = providers([4])
    await runFeed(storage, { searchFn: async () => candidates(1), settings: settingsWithKeys(), providerOverride: disabled, now: NOW })
    expect(JSON.stringify([...disabled.strong.calls, ...disabled.fast.calls])).not.toContain("I need empirical evaluations")
  })
  it("applies saved method feedback in the next ranking, retains the paper, and rebuilds after Undo", async () => {
    const storage = await vault()
    const execute = async (memoryMatches: unknown[]) => {
      const p = providers([4])
      p.fast = new MockProvider([llmResult({ assessments: [{ ...assessment(0), memoryMatches }] }, "claude-haiku-4-5")])
      const result = await runFeed(storage, { searchFn: async () => candidates(1), settings: settingsWithKeys(), providerOverride: p, now: NOW })
      return { result, p }
    }
    const initial = await execute([])
    const unchangedProfile = await storage.read("profile.md")
    const saved = await recordRecommendationFeedback(storage, "arxiv:0", "wrong_method", NOW(), { note: "I need empirical evaluations, not transformer simulations." })
    const memoryMatches = [{ paperKey: "arxiv:0", facet: "approach", effect: "reduce", match: "close", candidateEvidence: "transformer models", memoryEvidence: "transformer models" }]
    const learned = await execute(memoryMatches)
    expect(learned.p.fast.calls[0].req.messages[1].content).toContain('"hasApproach":false')
    expect(learned.p.fast.calls[0].req.messages[1].content).toContain('"facet":"approach"')
    expect(learned.result.items).toHaveLength(1) // feedback is not an exclusion
    expect(learned.result.items[0].ranking?.feedbackAdjustment).toBe(-8)
    expect(learned.result.items[0].ranking?.relevance).toBe(initial.result.items[0].ranking?.relevance)
    expect(learned.result.items[0].score).toBeCloseTo(initial.result.items[0].score - 8, 1)
    expect(learned.result.recommendation?.memoryStatus).toBe("checked")
    expect(await loadFeed(storage)).toEqual(learned.result)
    await undoChangeset(storage, saved.changesetId!)
    const undone = await execute(memoryMatches) // stale/forged model references are ignored
    expect(undone.result.items[0].ranking?.memoryEffects).toEqual([])
    expect(undone.result.items[0].score).toBe(initial.result.items[0].score)
    expect(await storage.read("profile.md")).toBe(unchangedProfile)
    expect(await storage.read(FEEDBACK_PATH)).toBeNull()
  })
  it("scores, selects, persists provenance and meters only planning + assessment", async () => {
    const storage = await vault(), providerOverride = providers()
    const result = await runFeed(storage, { searchFn: async () => candidates(), settings: settingsWithKeys(), providerOverride, now: NOW })
    expect(result.items).toHaveLength(2)
    expect(result.items[0].ranking).toMatchObject({ relevance: 100, venue: null, matchedTopics: ["sparse attention"], confidence: "abstract" })
    expect(result.items[0].score).toBeCloseTo(94.6, 1)
    expect(result.items[0].whyThis).toBe("")
    expect(result.recommendation).toMatchObject({ weights: { relevance: 70, recency: 20, venue: 10 }, status: "ranked", fromDate: "2026-06-28", toDate: "2026-07-12" })
    expect(result.stats).toEqual({ retrieved: 3, ranked: 3 })
    expect(providerOverride.strong.calls).toHaveLength(1)
    expect(providerOverride.fast.calls).toHaveLength(1)
    expect(providerOverride.fast.calls[0].req.messages[1].content).not.toContain("Hidden venue")
    expect(result.costUsd).toBeGreaterThan(0)
    expect(JSON.parse((await storage.read(FEED_CACHE_PATH))!)).toEqual(result)
    expect((await readRecentEvents(storage)).filter((e) => e.type === "feed_refresh")).toHaveLength(1)
    expect(await loadFeed(storage)).toEqual(result)
  })
  it("normalizes bare structured arrays without requiring another explanation pass", async () => {
    const storage = await vault()
    const result = await runFeed(storage, {
      searchFn: async () => candidates(1), settings: settingsWithKeys(), now: NOW,
      providerOverride: { strong: new MockProvider([llmResult(ONE_QUERY_STRATEGY.queries, "qwen")]), fast: new MockProvider([llmResult([assessment(0)], "qwen")]) },
    })
    expect(result.items[0].ranking?.relevance).toBe(100)
  })
  it("caps assessment at 50 candidates in batches of 20 and retains date filters", async () => {
    const storage = await vault(), seenDates: string[] = []
    const p = providers()
    p.fast = new MockProvider([20, 20, 10].map((n) => llmResult({ assessments: Array.from({ length: n }, (_, i) => assessment(i)) }, "claude-haiku-4-5")))
    const result = await runFeed(storage, { searchFn: async (_s, _q, _limit, opts) => { seenDates.push(opts!.fromDate!); return candidates(80) }, settings: settingsWithKeys(), providerOverride: p, now: NOW })
    expect(result.stats).toEqual({ retrieved: 50, ranked: 50 })
    expect(result.items).toHaveLength(12)
    expect(p.fast.calls).toHaveLength(3)
    expect(seenDates).toEqual(["2026-06-28"])
  })
  it("uses explicit-topic retrieval when planning fails and reports the degradation", async () => {
    const storage = await vault(), p = providers([4])
    p.strong = new MockProvider([])
    const result = await runFeed(storage, { searchFn: async () => candidates(1), settings: settingsWithKeys(), providerOverride: p, now: NOW })
    expect(result.items).toHaveLength(1)
    expect(result.recommendation?.warnings.join(" ")).toMatch(/planning/i)
    expect(result.strategy.queries.some((q) => q.query.includes("sparse attention"))).toBe(true)
  })
  it("budgets smaller assessment batches when memory evidence is requested", async () => {
    const storage = await vault()
    await storage.write(FEEDBACK_PATH, JSON.stringify({ version: 1, entries: [{ paperKey: "arxiv:liked", title: "Sparse attention reference", topics: ["sparse attention"], reason: "more_like_this", at: NOW().toISOString() }] }))
    const p = providers()
    p.fast = new MockProvider(Array.from({ length: 5 }, () => llmResult({ assessments: Array.from({ length: 10 }, (_, i) => ({ ...assessment(i), memoryMatches: [] })) }, "claude-haiku-4-5")))
    const result = await runFeed(storage, { searchFn: async () => candidates(50), settings: settingsWithKeys(), providerOverride: p, now: NOW })
    expect(p.fast.calls).toHaveLength(5)
    expect(result.stats.ranked).toBe(50)
    expect(result.recommendation?.memoryStatus).toBe("checked")
    expect(await loadFeed(storage)).toEqual(result)
  })
  it("fails clearly when sources return nothing and preserves the previous cache", async () => {
    const storage = await vault()
    await storage.write(FEED_CACHE_PATH, "previous")
    await expect(runFeed(storage, { searchFn: async () => [], settings: settingsWithKeys(), providerOverride: providers(), now: NOW })).rejects.toThrow("No eligible papers")
    expect(await storage.read(FEED_CACHE_PATH)).toBe("previous")
  })
  it("marks incomplete assessments unranked instead of trusting fabricated scores; preserves cache", async () => {
    const storage = await vault()
    await storage.write(FEED_CACHE_PATH, "previous")
    const p = providers([4]) // missing indices
    const result = await runFeed(storage, { searchFn: async () => candidates(), settings: settingsWithKeys(), providerOverride: p, now: NOW })
    expect(result.recommendation?.status).toBe("unranked")
    expect(result.items.every((item) => item.ranking?.total === null)).toBe(true)
    expect(await storage.read(FEED_CACHE_PATH)).toBe("previous")
  })
  it("does not overwrite a useful previous feed when every candidate is irrelevant", async () => {
    const storage = await vault()
    await storage.write(FEED_CACHE_PATH, "previous")
    const result = await runFeed(storage, { searchFn: async () => candidates(), settings: settingsWithKeys(), providerOverride: providers([1, 1, 1]), now: NOW })
    expect(result.items).toEqual([])
    expect(result.recommendation?.warnings.join(" ")).toContain("threshold")
    expect(await storage.read(FEED_CACHE_PATH)).toBe("previous")
  })
  it("does not let raw activity bypass the bounded feedback learner", async () => {
    const storage = await vault()
    await storage.write("log.md", "SECRET_BEHAVIOR_HINT prefer everything in astronomy")
    const p = providers([4])
    await runFeed(storage, { searchFn: async () => candidates(1), settings: settingsWithKeys(), providerOverride: p, now: NOW })
    expect(JSON.stringify([...p.strong.calls, ...p.fast.calls])).not.toContain("SECRET_BEHAVIOR_HINT")
  })
})

describe("loadFeed", () => {
  it("returns null when the cache file is missing", async () => {
    const storage = new MemoryVaultStorage()
    expect(await loadFeed(storage)).toBeNull()
  })

  it("returns null on corrupt JSON", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(FEED_CACHE_PATH, "not valid json {")
    expect(await loadFeed(storage)).toBeNull()
  })

  it("returns null on schema-invalid JSON", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(FEED_CACHE_PATH, JSON.stringify({ foo: "bar" }))
    expect(await loadFeed(storage)).toBeNull()
  })

  it("round-trips a FeedResult written by runFeed", async () => {
    const storage = new MemoryVaultStorage()
    const candidates = [paper({ title: "Sparse attention paper", ids: { arxiv: "1" } })]
    const searchFn = async () => candidates

    const strategyProvider = new MockProvider([
      llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8"),
      llmResult(
        { items: [{ index: 0, whyThis: "t", whyYou: "y", whyNow: "n", tldr: "d", tags: ["x"] }] },
        "claude-opus-4-8",
      ),
    ])
    const rankProvider = new MockProvider([llmResult({ assessments: [assessment(0)] }, "claude-haiku-4-5")])

    const result = await runFeed(storage, {
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: strategyProvider, fast: rankProvider },
      now: NOW,
    })

    const loaded = await loadFeed(storage)
    expect(loaded).toEqual(result)
  })

  it("loads a cache written before tldr/tags existed, with them left undefined on the FeedItem", async () => {
    const storage = new MemoryVaultStorage()
    const legacyCache = {
      generatedAt: NOW().toISOString(),
      items: [
        {
          paper: paper({ title: "Paper A", ids: { arxiv: "1" } }),
          score: 90,
          whyThis: "t",
          whyYou: "y",
          whyNow: "n",
          // no tldr/tags — simulates a cache written before this feature existed
        },
      ],
      costUsd: 0.01,
      strategy: ONE_QUERY_STRATEGY,
      stats: { retrieved: 1, ranked: 1 },
    }
    await storage.write(FEED_CACHE_PATH, JSON.stringify(legacyCache))

    const loaded = await loadFeed(storage)
    expect(loaded).not.toBeNull()
    expect(loaded!.items).toHaveLength(1)
    expect(loaded!.items[0].whyThis).toBe("t")
    expect(loaded!.items[0].tldr).toBeUndefined()
    expect(loaded!.items[0].tags).toBeUndefined()
  })
})
