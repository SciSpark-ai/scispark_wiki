import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { readRecentEvents } from "../../events/log"
import type { PaperRecord } from "../../papers/types"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { runFeed, loadFeed, FEED_CACHE_PATH, type FeedStrategy } from "../feed"

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

describe("runFeed", () => {
  it("full pipeline happy path: cache written, event logged, items carry why-fields + scores, cost summed across >=3 runs", async () => {
    const storage = new MemoryVaultStorage()
    const candidates = [
      paper({ title: "Paper A", ids: { arxiv: "1" } }),
      paper({ title: "Paper B", ids: { arxiv: "2" } }),
      paper({ title: "Paper C", ids: { arxiv: "3" } }),
    ]
    const searchFn = async () => candidates

    const strategyProvider = new MockProvider([
      llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8"),
      llmResult(
        {
          items: [
            { index: 0, whyThis: "strong results", whyYou: "matches your interests", whyNow: "just released" },
            { index: 1, whyThis: "novel method", whyYou: "adjacent topic", whyNow: "trending" },
          ],
        },
        "claude-opus-4-8",
      ),
    ])
    const rankProvider = new MockProvider([
      llmResult(
        {
          scores: [
            { index: 0, score: 90 },
            { index: 1, score: 40 },
            { index: 2, score: 70 },
          ],
        },
        "claude-haiku-4-5",
      ),
    ])

    const result = await runFeed(storage, {
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: strategyProvider, fast: rankProvider },
      now: NOW,
    })

    expect(result.items).toHaveLength(2)
    expect(result.items[0].paper.title).toBe("Paper A")
    expect(result.items[0].score).toBe(90)
    expect(result.items[0].whyThis).toBe("strong results")
    expect(result.items[0].whyYou).toBe("matches your interests")
    expect(result.items[0].whyNow).toBe("just released")
    expect(result.items[1].paper.title).toBe("Paper C")
    expect(result.items[1].score).toBe(70)
    expect(result.stats.retrieved).toBe(3)
    expect(result.stats.ranked).toBe(3)
    expect(result.strategy).toEqual(ONE_QUERY_STRATEGY)
    expect(result.generatedAt).toBe(NOW().toISOString())

    // costUsd summed across >=3 runs (strategy + 1 rank batch + rerank), all nonzero-priced models.
    expect(strategyProvider.calls).toHaveLength(2)
    expect(rankProvider.calls).toHaveLength(1)
    expect(result.costUsd).toBeGreaterThan(0)

    const cached = await storage.read(FEED_CACHE_PATH)
    expect(cached).not.toBeNull()
    expect(JSON.parse(cached!)).toEqual(result)

    const events = await readRecentEvents(storage)
    const refreshEvents = events.filter((e) => e.type === "feed_refresh")
    expect(refreshEvents).toHaveLength(1)
    expect(refreshEvents[0]).toMatchObject({ type: "feed_refresh", itemCount: 2 })
  })

  it("30 candidates split into two rank batches with correct global indexing", async () => {
    const storage = new MemoryVaultStorage()
    const candidates: PaperRecord[] = []
    for (let i = 0; i < 30; i++) {
      candidates.push(paper({ title: `Candidate-${i}`, ids: { arxiv: `id-${i}` } }))
    }
    const searchFn = async () => candidates

    const strategyProvider = new MockProvider([
      llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8"),
      // Re-rank: pick top20[0], which should resolve to Candidate-25 (highest score, from batch 2).
      llmResult(
        { items: [{ index: 0, whyThis: "t", whyYou: "y", whyNow: "n" }] },
        "claude-opus-4-8",
      ),
    ])

    // Batch 1 covers global indices 0-24, scores 0..24.
    const batch1Scores = Array.from({ length: 25 }, (_, i) => ({ index: i, score: i }))
    // Batch 2 covers global indices 25-29; give it the highest scores so Candidate-25 tops the ranking.
    const batch2Scores = [
      { index: 25, score: 100 },
      { index: 26, score: 99 },
      { index: 27, score: 98 },
      { index: 28, score: 97 },
      { index: 29, score: 96 },
    ]
    const rankProvider = new MockProvider([
      llmResult({ scores: batch1Scores }, "claude-haiku-4-5"),
      llmResult({ scores: batch2Scores }, "claude-haiku-4-5"),
    ])

    const result = await runFeed(storage, {
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: strategyProvider, fast: rankProvider },
      now: NOW,
    })

    expect(rankProvider.calls).toHaveLength(2)
    // Second batch's serialized candidate list must use global indices starting at 25, not 0.
    const secondBatchMessage = rankProvider.calls[1].req.messages[1].content
    expect(secondBatchMessage).toContain("[25]")
    expect(secondBatchMessage).not.toContain("[0] Candidate-25")

    expect(result.stats.retrieved).toBe(30)
    expect(result.stats.ranked).toBe(30)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].paper.title).toBe("Candidate-25")
    expect(result.items[0].score).toBe(100)
  })

  it("drops bad indices from rank and re-rank stages without crashing", async () => {
    const storage = new MemoryVaultStorage()
    const candidates = [
      paper({ title: "Paper A", ids: { arxiv: "1" } }),
      paper({ title: "Paper B", ids: { arxiv: "2" } }),
      paper({ title: "Paper C", ids: { arxiv: "3" } }),
    ]
    const searchFn = async () => candidates

    const strategyProvider = new MockProvider([
      llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8"),
      llmResult(
        {
          items: [
            { index: 0, whyThis: "t", whyYou: "y", whyNow: "n" },
            { index: 99, whyThis: "bad", whyYou: "bad", whyNow: "bad" }, // out of top20 range, dropped
          ],
        },
        "claude-opus-4-8",
      ),
    ])
    const rankProvider = new MockProvider([
      llmResult(
        {
          scores: [
            { index: 0, score: 90 },
            { index: 5, score: 50 }, // out of range for this batch (only indices 0-2 valid), dropped
            { index: -1, score: 20 }, // negative, dropped
          ],
        },
        "claude-haiku-4-5",
      ),
    ])

    const result = await runFeed(storage, {
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: strategyProvider, fast: rankProvider },
      now: NOW,
    })

    expect(result.stats.ranked).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].paper.title).toBe("Paper A")
  })

  it("drops duplicate indices in rank and re-rank output — a paper never renders twice", async () => {
    const storage = new MemoryVaultStorage()
    const candidates = [
      paper({ title: "Paper A", ids: { arxiv: "1" } }),
      paper({ title: "Paper B", ids: { arxiv: "2" } }),
    ]
    const searchFn = async () => candidates

    const strategyProvider = new MockProvider([
      llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8"),
      llmResult(
        {
          items: [
            { index: 0, whyThis: "t1", whyYou: "y1", whyNow: "n1" },
            { index: 0, whyThis: "t2", whyYou: "y2", whyNow: "n2" }, // duplicate, dropped
            { index: 1, whyThis: "t3", whyYou: "y3", whyNow: "n3" },
          ],
        },
        "claude-opus-4-8",
      ),
    ])
    const rankProvider = new MockProvider([
      llmResult(
        {
          scores: [
            { index: 0, score: 90 },
            { index: 0, score: 10 }, // duplicate, dropped (first occurrence wins)
            { index: 1, score: 80 },
          ],
        },
        "claude-haiku-4-5",
      ),
    ])

    const result = await runFeed(storage, {
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: strategyProvider, fast: rankProvider },
      now: NOW,
    })

    expect(result.stats.ranked).toBe(2)
    expect(result.items).toHaveLength(2)
    expect(result.items.map((i) => i.paper.title)).toEqual(["Paper A", "Paper B"])
    expect(result.items[0].score).toBe(90) // first occurrence's score, not the duplicate's
    expect(result.items[0].whyThis).toBe("t1")
  })

  it("throws without writing cache when zero candidates are retrieved", async () => {
    const storage = new MemoryVaultStorage()
    const searchFn = async () => []

    const strategyProvider = new MockProvider([llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8")])
    const rankProvider = new MockProvider([])

    await expect(
      runFeed(storage, {
        searchFn,
        settings: settingsWithKeys(),
        providerOverride: { strong: strategyProvider, fast: rankProvider },
        now: NOW,
      }),
    ).rejects.toThrow("no candidates retrieved — try adjusting profile.md or interests.md")

    expect(await storage.read(FEED_CACHE_PATH)).toBeNull()
    expect(rankProvider.calls).toHaveLength(0)
  })

  it("throws when re-rank returns no valid items, leaving previous cache intact", async () => {
    const storage = new MemoryVaultStorage()
    const staleCache = JSON.stringify({ stale: true })
    await storage.write(FEED_CACHE_PATH, staleCache)

    const candidates = [paper({ title: "Paper A", ids: { arxiv: "1" } })]
    const searchFn = async () => candidates

    const strategyProvider = new MockProvider([
      llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8"),
      llmResult({ items: [] }, "claude-opus-4-8"),
    ])
    const rankProvider = new MockProvider([llmResult({ scores: [{ index: 0, score: 90 }] }, "claude-haiku-4-5")])

    await expect(
      runFeed(storage, {
        searchFn,
        settings: settingsWithKeys(),
        providerOverride: { strong: strategyProvider, fast: rankProvider },
        now: NOW,
      }),
    ).rejects.toThrow("feed re-rank returned no items")

    expect(await storage.read(FEED_CACHE_PATH)).toBe(staleCache)
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
    const candidates = [paper({ title: "Paper A", ids: { arxiv: "1" } })]
    const searchFn = async () => candidates

    const strategyProvider = new MockProvider([
      llmResult(ONE_QUERY_STRATEGY, "claude-opus-4-8"),
      llmResult({ items: [{ index: 0, whyThis: "t", whyYou: "y", whyNow: "n" }] }, "claude-opus-4-8"),
    ])
    const rankProvider = new MockProvider([llmResult({ scores: [{ index: 0, score: 90 }] }, "claude-haiku-4-5")])

    const result = await runFeed(storage, {
      searchFn,
      settings: settingsWithKeys(),
      providerOverride: { strong: strategyProvider, fast: rankProvider },
      now: NOW,
    })

    const loaded = await loadFeed(storage)
    expect(loaded).toEqual(result)
  })
})
