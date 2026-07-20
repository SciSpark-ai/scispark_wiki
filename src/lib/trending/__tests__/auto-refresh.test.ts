import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { SearchFn } from "../../skills/feed"
import { saveTrendingSettings } from "../settings"
import { maybeAutoRefreshTrending, backoffMs, REFRESH_FAILURE_PATH } from "../auto-refresh"
import { loadDashboard, DASHBOARD_CACHE_PATH } from "../dashboard"

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

const NOW = () => new Date("2026-07-14T00:00:00.000Z")
function structured(o: unknown): LLMResult {
  return { text: JSON.stringify(o), json: o, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
const SURVEY = { notablePapers: [{ title: "A", why: "x" }], emergingTopics: [{ topic: "T", why: "y" }], momentum: "up" }
const SETTINGS = { keys: { openai: "sk" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://x/v1" } } as const
const searchFn: SearchFn = async () => []

describe("maybeAutoRefreshTrending", () => {
  it("returns 'no-fields' when nothing is tracked and interests are empty", async () => {
    const storage = new MemoryVaultStorage()
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW })
    expect(r).toBe("no-fields")
  })

  it("refreshes when fields exist and no dashboard is cached", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    const provider = new MockProvider([structured(SURVEY)])
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
    expect(await loadDashboard(storage)).not.toBeNull()
  })

  it("returns 'fresh' when a recent dashboard already exists for the same fields", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    await storage.write(
      ".scispark/trending/dashboard.json",
      JSON.stringify({
        panels: [{ field: { slug: "nlp", label: "NLP" }, metrics: {}, survey: null, generatedAt: "2026-07-13T00:00:00.000Z" }],
        generatedAt: "2026-07-13T00:00:00.000Z",
      }),
    )
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW })
    expect(r).toBe("fresh")
  })

  it("refreshes when the cached dashboard's panels are for a different field set than tracked fields", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    // Cached dashboard is time-fresh (generatedAt == NOW) but for a DIFFERENT field ("old"),
    // simulating a settings change (e.g. via /profile) that swapped tracked fields without a
    // corresponding refresh. Per T8's fieldsMatchDashboard addition, this must still refresh.
    await storage.write(
      ".scispark/trending/dashboard.json",
      JSON.stringify({
        panels: [{ field: { slug: "old", label: "Old" }, metrics: {}, survey: null, generatedAt: NOW().toISOString() }],
        generatedAt: NOW().toISOString(),
      }),
    )
    const provider = new MockProvider([structured(SURVEY)])
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
    // Strengthen beyond the return-string check: assert the refresh actually
    // ran — the provider was invoked, and the cache now holds a panel for the
    // NEW tracked field ("nlp"), not the stale cached one ("old").
    expect(provider.calls.length).toBeGreaterThan(0)
    const dashboard = await loadDashboard(storage)
    expect(dashboard?.panels.map((p) => p.field.slug)).toEqual(["nlp"])
  })

  it("(a) an orchestrator throw returns 'failed' and writes a failure marker with consecutiveFailures: 1", async () => {
    const storage = new ThrowingDashboardWriteStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW })
    expect(r).toBe("failed")
    const raw = await storage.read(REFRESH_FAILURE_PATH)
    expect(raw).not.toBeNull()
    const marker = JSON.parse(raw as string)
    expect(marker.consecutiveFailures).toBe(1)
    expect(marker.lastFailureAt).toBe(NOW().toISOString())
    expect(marker.lastError).toBeTruthy()
  })

  it("(b) a second call inside the backoff window returns 'backoff' without invoking the orchestrator", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    // Failure recorded 5 minutes before NOW; backoffMs(1) is 30 minutes, so this is still within the window.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-13T23:55:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    let calls = 0
    const spySearchFn: SearchFn = async (...args) => {
      calls++
      return searchFn(...args)
    }
    const r = await maybeAutoRefreshTrending(storage, { searchFn: spySearchFn, settings: SETTINGS, now: NOW })
    expect(r).toBe("backoff")
    expect(calls).toBe(0)
  })

  it("(c) a call after the backoff window elapses runs again; failure increments to 2 and the window widens", async () => {
    const storage = new ThrowingDashboardWriteStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    // Failure recorded 31 minutes before NOW; backoffMs(1) is 30 minutes, so the window has elapsed.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-13T23:29:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW })
    expect(r).toBe("failed")
    const marker = JSON.parse((await storage.read(REFRESH_FAILURE_PATH)) as string)
    expect(marker.consecutiveFailures).toBe(2)
    expect(marker.lastFailureAt).toBe(NOW().toISOString())
  })

  it("(d) a success deletes the failure marker and returns 'refreshed'", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    // Failure recorded well outside any window so the run is attempted.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-01T00:00:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    const provider = new MockProvider([structured(SURVEY)])
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW, providerOverride: { strong: provider } })
    expect(r).toBe("refreshed")
    expect(await storage.read(REFRESH_FAILURE_PATH)).toBeNull()
  })

  it("(e) a marker older than the cached dashboard's generatedAt is ignored (a later success supersedes it)", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly" })
    // Cached dashboard is for a DIFFERENT field ("old"), so a refresh is needed regardless of
    // freshness (mirrors the fieldsMatchDashboard test above) — this isolates the marker-ignore
    // logic from the elapsed-window logic (the marker below is otherwise still well within its
    // backoff window relative to NOW).
    await storage.write(
      ".scispark/trending/dashboard.json",
      JSON.stringify({
        panels: [{ field: { slug: "old", label: "Old" }, metrics: {}, survey: null, generatedAt: "2026-07-13T23:58:00.000Z" }],
        generatedAt: "2026-07-13T23:58:00.000Z",
      }),
    )
    // lastFailureAt (23:55) predates the cached dashboard's generatedAt (23:58): a successful
    // refresh happened after the recorded failure, so the marker is obsolete.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: "2026-07-13T23:55:00.000Z", consecutiveFailures: 1, lastError: "boom" }),
    )
    const provider = new MockProvider([structured(SURVEY)])
    const r = await maybeAutoRefreshTrending(storage, { searchFn, settings: SETTINGS, now: NOW, providerOverride: { strong: provider } })
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
