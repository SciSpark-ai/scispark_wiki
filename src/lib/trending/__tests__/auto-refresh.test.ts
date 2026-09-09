import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { TopicGroupFn, TopWorksFn } from "../../papers/node-search"
import { saveTrendingSettings } from "../settings"
import { maybeAutoRefreshTrending, backoffMs, REFRESH_FAILURE_PATH } from "../auto-refresh"
import { loadBoard, TRENDING_BOARD_VERSION, DASHBOARD_CACHE_PATH } from "../dashboard"
import { completeWindows } from "../topics"
import type { CountFn } from "../counts"
/** Throws writing the dashboard cache path — simulates `runTrendingDashboard`
 * failing AFTER its per-field try/catch (e.g. the final storage.write), which
 * is the only way to make the orchestrator itself reject rather than degrade
 * a single field's panel (mirrors the FlakyStorage pattern in
 * src/lib/lint/__tests__/run.test.ts). */
class ThrowingDashboardWriteStorage extends MemoryVaultStorage {
  async write(path: string, content: string): Promise<void> {
    if (path === DASHBOARD_CACHE_PATH) throw new Error("disk full")
    return super.write(path, content)
  }
}

/** Throws writing EITHER the dashboard cache path or the failure-marker path
 * — simulates a storage backend so broken (e.g. genuinely out of disk) that
 * even the best-effort marker bookkeeping fails after the orchestrator's own
 * write already failed. Settings writes (test setup via saveTrendingSettings)
 * still succeed, so only the two paths under test are affected. Used to
 * prove maybeAutoRefreshTrending's failure branch never lets that second
 * throw escape as an unhandled rejection. */
class ThrowingDashboardAndMarkerWriteStorage extends MemoryVaultStorage {
  async write(path: string, content: string): Promise<void> {
    if (path === DASHBOARD_CACHE_PATH || path === REFRESH_FAILURE_PATH) throw new Error("disk full")
    return super.write(path, content)
  }
}

const NOW = () => new Date("2026-07-14T00:00:00.000Z")
const WINDOWS = completeWindows(NOW())
function structured(o: unknown): LLMResult {
  return { text: JSON.stringify(o), json: o, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
const BRIEFS = { topics: [{ key: "T1", why: "x" }], crossDisciplineNote: "up" }
const SETTINGS = { keys: { openai: "sk" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://x/v1" } } as const
/** No papers: this suite is about staleness/scope decisions, not retrieval. */
const topWorksFn: TopWorksFn = async () => []

const NEURO = { id: "https://openalex.org/fields/28", label: "Neuroscience" }
const OLD_ANCHOR = { id: "https://openalex.org/fields/17", label: "Computer Science" }

const fieldGroupFn: TopicGroupFn = async () => [{ key: NEURO.id, label: NEURO.label, count: 500 }]
// Only the RECENT window is grouped now; prior counts come from countFn.
const topicGroupFn: TopicGroupFn = async ({ fromDate }) =>
  fromDate === WINDOWS.recent.fromDate ? [{ key: "T1", label: "Auditory Attention Decoding", count: 40 }] : []
const countFn: CountFn = async ({ topicId, fromDate }) =>
  topicId === "T1" && fromDate === WINDOWS.prior.fromDate ? 10 : 4

const deps = { topWorksFn, topicGroupFn, fieldGroupFn, countFn, settings: SETTINGS, now: NOW }

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

  it("refreshes for manual general topics even without narrow interests", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [], cadence: "weekly", anchors: [NEURO], anchorsOverridden: true })
    const provider = new MockProvider([structured(BRIEFS)])
    expect(await maybeAutoRefreshTrending(storage, { ...deps, providerOverride: { strong: provider } })).toBe("refreshed")
    expect((await loadBoard(storage))?.anchors).toEqual([NEURO])
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

  it("(a) an orchestrator throw returns 'failed' and writes a failure marker with consecutiveFailures: 1", async () => {
    const storage = new ThrowingDashboardWriteStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [NEURO], anchorsOverridden: true })
    const r = await maybeAutoRefreshTrending(storage, { ...deps })
    expect(r).toBe("failed")
    const raw = await storage.read(REFRESH_FAILURE_PATH)
    expect(raw).not.toBeNull()
    const marker = JSON.parse(raw as string)
    expect(marker.consecutiveFailures).toBe(1)
    expect(marker.lastFailureAt).toBe(NOW().toISOString())
    expect(marker.lastError).toBeTruthy()
  })

  it("(a2) a compound failure (dashboard write AND marker write both throw) still resolves to 'failed', never rejects", async () => {
    const storage = new ThrowingDashboardAndMarkerWriteStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [NEURO], anchorsOverridden: true })
    await expect(maybeAutoRefreshTrending(storage, { ...deps })).resolves.toBe("failed")
    // The marker write itself failed, so no marker persisted — confirms the
    // write really was attempted-and-swallowed rather than silently skipped.
    expect(await storage.read(REFRESH_FAILURE_PATH)).toBeNull()
  })

  it("(b) a second call inside the backoff window returns 'backoff' without invoking the orchestrator", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [NEURO], anchorsOverridden: true })
    // Failure recorded 5 minutes before NOW; backoffMs(1) is 30 minutes, so this is still within the window.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-13T23:55:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    let calls = 0
    const spySearchFn: TopWorksFn = async (...args) => {
      calls++
      return topWorksFn(...args)
    }
    const r = await maybeAutoRefreshTrending(storage, { ...deps, topWorksFn: spySearchFn })
    expect(r).toBe("backoff")
    expect(calls).toBe(0)
  })

  it("(c) a call after the backoff window elapses runs again; failure increments to 2 and the window widens", async () => {
    const storage = new ThrowingDashboardWriteStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [NEURO], anchorsOverridden: true })
    // Failure recorded 31 minutes before NOW; backoffMs(1) is 30 minutes, so the window has elapsed.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-13T23:29:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    const r = await maybeAutoRefreshTrending(storage, { ...deps })
    expect(r).toBe("failed")
    const marker = JSON.parse((await storage.read(REFRESH_FAILURE_PATH)) as string)
    expect(marker.consecutiveFailures).toBe(2)
    expect(marker.lastFailureAt).toBe(NOW().toISOString())
  })

  it("(d) a success deletes the failure marker and returns 'refreshed'", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [NEURO], anchorsOverridden: true })
    // Failure recorded well outside any window so the run is attempted.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-01T00:00:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    const provider = new MockProvider([structured(BRIEFS)])
    const r = await maybeAutoRefreshTrending(storage, { ...deps, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
    expect(await storage.read(REFRESH_FAILURE_PATH)).toBeNull()
  })

  it("(e) a marker older than the cached dashboard's generatedAt is ignored (a later success supersedes it)", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [NEURO], anchorsOverridden: true })
    // Cached dashboard is for a DIFFERENT field ("old"), so a refresh is needed regardless of
    // freshness (mirrors the fieldsMatchDashboard test above) — this isolates the marker-ignore
    // logic from the elapsed-window logic (the marker below is otherwise still well within its
    // backoff window relative to NOW).
    await writeBoard(storage, "2026-07-13T23:58:00.000Z", [OLD_ANCHOR])
    // lastFailureAt (23:55) predates the cached dashboard's generatedAt (23:58): a successful
    // refresh happened after the recorded failure, so the marker is obsolete.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-13T23:55:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    const provider = new MockProvider([structured(BRIEFS)])
    const r = await maybeAutoRefreshTrending(storage, { ...deps, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
  })

  it("(f) backoffMs is pure: 1->30m, 2->1h, 3->2h, 5->6h (cap)", () => {
    const MIN = 60 * 1000
    const HOUR = 60 * MIN
    expect(backoffMs(1)).toBe(30 * MIN)
    expect(backoffMs(2)).toBe(1 * HOUR)
    expect(backoffMs(3)).toBe(2 * HOUR)
    expect(backoffMs(5)).toBe(6 * HOUR)
  })
})
