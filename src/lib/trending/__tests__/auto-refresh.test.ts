import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { SearchFn } from "../../skills/feed"
import { saveTrendingSettings } from "../settings"
import { maybeAutoRefreshTrending } from "../auto-refresh"
import { loadDashboard } from "../dashboard"

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
})
