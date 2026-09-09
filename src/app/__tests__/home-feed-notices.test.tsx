// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { DEFAULT_RECOMMENDATION_PREFERENCES, type RecommendationRun } from "@/lib/recommendation/contract"
import { useUserStore } from "@/stores/user-store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => new MemoryVaultStorage() }))
vi.mock("@/lib/usermodel/pages", () => ({ isOnboarded: async () => true }))
vi.mock("@/lib/skills/feed-cache", () => ({ loadFeed: load }))
vi.mock("@/lib/vault/bundle", () => ({ loadBundle: async () => ({ pages: new Map() }) }))
vi.mock("@/lib/recommendation/client", () => ({ loadRecommendationFeedback: async () => ({ entries: [], warning: null }) }))
vi.mock("@/components/companion/useCompanion", () => ({ useCompanion: () => {} }))
vi.mock("@/components/feed/FeedRefreshBar", () => ({ FeedRefreshBar: () => <button>Refresh feed</button> }))
vi.mock("@/components/feed/RealFeedCard", () => ({ RealFeedCard: () => <div>Paper</div> }))
import HomePage from "../page"

function recommendation(overrides: Partial<RecommendationRun> = {}): RecommendationRun {
  return { version: "weighted-v2", preferences: { ...DEFAULT_RECOMMENDATION_PREFERENCES, diversity: "focused" },
    weights: { relevance: 70, recency: 20, venue: 10 }, fromDate: "2026-08-23", toDate: "2026-09-06", olderFromDate: null,
    warnings: [], retrieval: [], learnedTopics: [], status: "ranked", ...overrides }
}
async function mount(run: RecommendationRun) {
  load.mockResolvedValue({ generatedAt: "2026-09-06T10:22:53.808Z", recommendation: run, items: [] })
  const host = document.createElement("div")
  const root = createRoot(host)
  await act(async () => root.render(<HomePage />))
  return { host, cleanup: () => act(() => root.unmount()) }
}

beforeEach(() => { useUserStore.setState({ user: { name: "Tong" } }) })
describe("Home feed context", () => {
  it("keeps publication dates but no recommendation setting or edit-preferences link", async () => {
    const { host, cleanup } = await mount(recommendation())
    try {
      expect(host.textContent).toContain("Publication window: 2026-08-23 to 2026-09-06")
      expect(host.textContent).not.toMatch(/focused exploration|edit preferences/i)
      expect(host.querySelector('a[href*="recommendations"]')).toBeNull()
      expect(host.querySelector("details")).toBeNull()
    } finally { cleanup() }
  })
  it("renders the user's cached failures as dated, collapsed coverage notes, not current outages", async () => {
    const { host, cleanup } = await mount(recommendation({
      warnings: ["s2: Source unavailable or timed out", "pubmed: Source unavailable or timed out"],
      retrieval: [
        { source: "s2", query: "private-query", count: 0, error: "Source unavailable or timed out" },
        { source: "s2", query: "private-query", count: 14 },
      ],
    }))
    try {
      const details = host.querySelector("details")!
      expect(details).not.toBeNull()
      expect(details.open).toBe(false)
      expect(details.querySelector("summary")?.textContent).toBe("Some searches were incomplete on the last refresh")
      expect(details.querySelector("time")?.dateTime).toBe("2026-09-06T10:22:53.808Z")
      expect(details.textContent).toContain("not a live source-status check")
      expect(details.textContent).toContain("Semantic Scholar")
      expect(details.textContent).toContain("PubMed")
      expect(details.textContent).toContain("Other searches to this source completed")
      expect(host.textContent).not.toContain("Source unavailable or timed out")
      expect(host.textContent).not.toContain("private-query")
      expect(host.querySelector('[role="status"]')).toBeNull()
    } finally { cleanup() }
  })
  it("does not hide assessment warnings with source diagnostics", async () => {
    const { host, cleanup } = await mount(recommendation({ warnings: [
      "Semantic Scholar: Rate limited; some papers could not be retrieved.",
      "Results are unranked; preferences have not been fully checked.",
    ], status: "unranked" }))
    try {
      expect(host.querySelector('[role="status"]')?.textContent).toContain("Results are unranked")
      expect(host.querySelector("details")?.textContent).toContain("request limit")
    } finally { cleanup() }
  })
  it("deduplicates source notices and never renders arbitrary upstream error text", async () => {
    const { host, cleanup } = await mount(recommendation({ warnings: ["pubmed: timeout", "PubMed: timeout"], retrieval: [
      { source: "pubmed", query: "private", count: 0, error: "https://example.test/?api_key=secret" },
    ] }))
    try {
      expect(host.querySelectorAll("details li")).toHaveLength(1)
      expect(host.textContent).not.toMatch(/secret|private|api_key/)
    } finally { cleanup() }
  })
})
