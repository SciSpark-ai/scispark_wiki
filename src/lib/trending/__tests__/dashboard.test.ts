import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { SearchFn } from "../../skills/feed"
import { readRecentEvents } from "../../events/log"
import { runTrendingDashboard, loadDashboard, isStale, DASHBOARD_CACHE_PATH } from "../dashboard"

const NOW = () => new Date("2026-07-14T00:00:00.000Z")
function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...o }
}
function structured(output: unknown): LLMResult {
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 100, outputTokens: 50 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
const SURVEY = { notablePapers: [{ title: "A", why: "x" }], emergingTopics: [{ topic: "T", why: "y" }], momentum: "up" }
const SETTINGS = { keys: { openai: "sk" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://x/v1" } } as const

describe("runTrendingDashboard", () => {
  it("caches a dashboard with real metrics + survey per field and logs an event", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structured(SURVEY)])
    const searchFn: SearchFn = async () => [paper({ title: "Fresh", date: "2026-07-10", year: 2026, citationCount: 3, venue: "ACL" })]
    const dash = await runTrendingDashboard(storage, {
      fields: [{ slug: "nlp", label: "NLP" }], searchFn, settings: SETTINGS, providerOverride: { strong: provider }, now: NOW,
    })
    expect(dash.panels).toHaveLength(1)
    expect(dash.panels[0].metrics.paperCountRecent).toBe(1) // real, deterministic
    expect(dash.panels[0].survey).toEqual(SURVEY)
    // cached
    const loaded = await loadDashboard(storage)
    expect(loaded?.panels[0].field.slug).toBe("nlp")
    expect((await storage.read(DASHBOARD_CACHE_PATH))).not.toBeNull()
    // event logged
    const events = await readRecentEvents(storage)
    expect(events.some((e) => e.type === "trending_refresh")).toBe(true)
  })

  it("a skill failure degrades that panel to survey:null but keeps its metrics", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([new Error("llm exploded")])
    const searchFn: SearchFn = async () => [paper({ title: "Fresh", date: "2026-07-10", year: 2026 })]
    const dash = await runTrendingDashboard(storage, {
      fields: [{ slug: "nlp", label: "NLP" }], searchFn, settings: SETTINGS, providerOverride: { strong: provider }, now: NOW,
    })
    expect(dash.panels[0].survey).toBeNull()
    expect(dash.panels[0].error).toBeTruthy()
    expect(dash.panels[0].metrics.paperCountRecent).toBe(1) // metrics still computed
  })

  it("an unexpected per-field throw (not a skill failure) degrades only that field's panel, keeping the others + cache + event log", async () => {
    const storage = new MemoryVaultStorage()
    // Two structured results queued: only the healthy field's skill run consumes one.
    const provider = new MockProvider([structured(SURVEY), structured(SURVEY)])
    // The "nlp" field returns a clean record. The "bio" field returns a record
    // with a non-string `venue` — nothing upstream validates this at runtime,
    // so it flows through `retrieveFieldCandidates` untouched and blows up
    // inside `computeFieldMetrics`'s `p.venue?.trim()` (TypeError: not a
    // function). This genuinely exercises the outer per-field try/catch in
    // runTrendingDashboard, as opposed to the skill-failure branch (which
    // never throws) exercised by the test above.
    const searchFn: SearchFn = async (_source, fieldLabel) => {
      if (fieldLabel === "Bio") {
        return [
          {
            ...paper({ title: "Malformed", date: "2026-07-10", year: 2026 }),
            venue: 42 as unknown as string,
          },
        ]
      }
      return [paper({ title: "Fresh", date: "2026-07-10", year: 2026, citationCount: 3, venue: "ACL" })]
    }
    const dash = await runTrendingDashboard(storage, {
      fields: [
        { slug: "nlp", label: "NLP" },
        { slug: "bio", label: "Bio" },
      ],
      searchFn,
      settings: SETTINGS,
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(dash.panels).toHaveLength(2)
    const nlp = dash.panels.find((p) => p.field.slug === "nlp")
    const bio = dash.panels.find((p) => p.field.slug === "bio")
    expect(nlp?.survey).toEqual(SURVEY)
    expect(nlp?.metrics.paperCountRecent).toBe(1)
    expect(bio?.survey).toBeNull()
    expect(bio?.error).toBeTruthy()
    // Degraded panel still carries valid, empty-but-well-formed metrics.
    expect(bio?.metrics.paperCountRecent).toBe(0)
    expect(bio?.metrics.topMovers).toEqual([])
    expect(bio?.generatedAt).toBe(NOW().toISOString())

    // The whole dashboard still completed: cache write + event log unaffected.
    const loaded = await loadDashboard(storage)
    expect(loaded?.panels).toHaveLength(2)
    const events = await readRecentEvents(storage)
    const refresh = events.find((e) => e.type === "trending_refresh")
    expect(refresh).toBeTruthy()
    expect((refresh as { fieldCount?: number })?.fieldCount).toBe(2)
  })
})

describe("isStale", () => {
  it("null dashboard is always stale", () => {
    expect(isStale(null, "weekly", NOW())).toBe(true)
  })
  it("weekly: stale after 7 days, fresh before", () => {
    const fresh = { panels: [], generatedAt: "2026-07-10T00:00:00.000Z" }
    const old = { panels: [], generatedAt: "2026-07-01T00:00:00.000Z" }
    expect(isStale(fresh, "weekly", NOW())).toBe(false)
    expect(isStale(old, "weekly", NOW())).toBe(true)
  })
  it("daily: stale after 1 day", () => {
    const y = { panels: [], generatedAt: "2026-07-12T00:00:00.000Z" }
    expect(isStale(y, "daily", NOW())).toBe(true)
  })

  it("weekly: exactly 7*24h old is stale (boundary is inclusive)", () => {
    const exact = { panels: [], generatedAt: "2026-07-07T00:00:00.000Z" } // NOW() - 7d exactly
    expect(isStale(exact, "weekly", NOW())).toBe(true)
  })

  it("weekly: 7 days minus 1ms old is still fresh (just inside the window)", () => {
    const justInside = { panels: [], generatedAt: "2026-07-07T00:00:00.001Z" } // NOW() - (7d - 1ms)
    expect(isStale(justInside, "weekly", NOW())).toBe(false)
  })

  it("daily: exactly 24h old is stale (boundary is inclusive)", () => {
    const exact = { panels: [], generatedAt: "2026-07-13T00:00:00.000Z" } // NOW() - 24h exactly
    expect(isStale(exact, "daily", NOW())).toBe(true)
  })
})
