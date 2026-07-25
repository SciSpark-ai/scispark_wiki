import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { SearchFn } from "../../skills/feed"
import type { TopicGroupFn } from "../../papers/node-search"
import { saveTrendingSettings } from "../settings"
import { maybeAutoRefreshTrending } from "../auto-refresh"
import { loadBoard, TRENDING_BOARD_VERSION, DASHBOARD_CACHE_PATH } from "../dashboard"
import { completeWindows } from "../topics"
import type { CountFn } from "../weekly-volume"

const NOW = () => new Date("2026-07-14T00:00:00.000Z")
const WINDOWS = completeWindows(NOW())
function structured(o: unknown): LLMResult {
  return { text: JSON.stringify(o), json: o, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
const BRIEFS = { topics: [{ key: "T1", why: "x" }], crossDisciplineNote: "up" }
const SETTINGS = { keys: { openai: "sk" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://x/v1" } } as const
const searchFn: SearchFn = async () => []

const NEURO = { id: "https://openalex.org/fields/28", label: "Neuroscience" }
const OLD_ANCHOR = { id: "https://openalex.org/fields/17", label: "Computer Science" }

const fieldGroupFn: TopicGroupFn = async () => [{ key: NEURO.id, label: NEURO.label, count: 500 }]
// Only the RECENT window is grouped now; prior counts come from countFn.
const topicGroupFn: TopicGroupFn = async ({ fromDate }) =>
  fromDate === WINDOWS.recent.fromDate ? [{ key: "T1", label: "Auditory Attention Decoding", count: 40 }] : []
const countFn: CountFn = async ({ topicId, fromDate }) =>
  topicId === "T1" && fromDate === WINDOWS.prior.fromDate ? 10 : 4

const deps = { searchFn, topicGroupFn, fieldGroupFn, countFn, settings: SETTINGS, now: NOW }

/** A cached board of the CURRENT structure version, generated at `generatedAt`. */
async function writeBoard(
  storage: MemoryVaultStorage,
  generatedAt: string,
  anchors: Array<{ id: string; label: string }>,
) {
  await storage.write(
    DASHBOARD_CACHE_PATH,
    JSON.stringify({
      version: TRENDING_BOARD_VERSION,
      anchors,
      overview: { totalRecent: 0, topTopicLabel: null, topTopicGrowth: null, relevantCount: 0 },
      topics: [],
      breakouts: [],
      crossDisciplineNote: null,
      generatedAt,
    }),
  )
}

describe("maybeAutoRefreshTrending", () => {
  it("returns 'no-fields' when nothing is tracked and interests are empty", async () => {
    const storage = new MemoryVaultStorage()
    const r = await maybeAutoRefreshTrending(storage, deps)
    expect(r).toBe("no-fields")
  })

  it("refreshes when fields exist and no board is cached", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, {
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "weekly",
      anchors: [],
      anchorsOverridden: false,
    })
    const provider = new MockProvider([structured(BRIEFS)])
    const r = await maybeAutoRefreshTrending(storage, { ...deps, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
    expect(await loadBoard(storage)).not.toBeNull()
  })

  it("returns 'fresh' when a recent board already exists for the same anchors", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, {
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "weekly",
      anchors: [NEURO],
      anchorsOverridden: false,
    })
    await writeBoard(storage, "2026-07-13T00:00:00.000Z", [NEURO])
    const r = await maybeAutoRefreshTrending(storage, deps)
    expect(r).toBe("fresh")
  })

  it("refreshes when the cached board's anchors differ from the settings' anchors", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, {
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "weekly",
      anchors: [NEURO],
      anchorsOverridden: true,
    })
    // Time-fresh but built for a DIFFERENT anchor scope (the user edited
    // anchors in settings without a corresponding refresh).
    await writeBoard(storage, NOW().toISOString(), [OLD_ANCHOR])
    const provider = new MockProvider([structured(BRIEFS)])
    const r = await maybeAutoRefreshTrending(storage, { ...deps, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
    expect(provider.calls.length).toBeGreaterThan(0)
    const board = await loadBoard(storage)
    expect(board?.anchors).toEqual([NEURO])
  })

  it("refreshes when the cache is the old (unversioned) v1 dashboard shape", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, {
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "weekly",
      anchors: [NEURO],
      anchorsOverridden: false,
    })
    await storage.write(
      DASHBOARD_CACHE_PATH,
      JSON.stringify({ panels: [{ field: { slug: "nlp", label: "NLP" } }], generatedAt: NOW().toISOString() }),
    )
    const provider = new MockProvider([structured(BRIEFS)])
    const r = await maybeAutoRefreshTrending(storage, { ...deps, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
  })

  it("does not treat a board as scope-stale when no anchors have been derived yet", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, {
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "weekly",
      anchors: [], // derivation hasn't produced anything (yet, or it failed)
      anchorsOverridden: false,
    })
    // A time-fresh board whose anchors can't be compared must NOT trigger a
    // refresh — otherwise every app open would spend strong-tier tokens.
    await writeBoard(storage, NOW().toISOString(), [{ id: "nlp", label: "NLP" }])
    const r = await maybeAutoRefreshTrending(storage, deps)
    expect(r).toBe("fresh")
  })
})
