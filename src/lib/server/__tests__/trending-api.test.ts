import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { SearchFn } from "../../skills/feed"
import type { TopicGroupFn } from "../../papers/node-search"
import { loadBoard, DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION, type TrendingBoard } from "../../trending/dashboard"
import { completeWindows } from "../../trending/topics"
import type { CountFn, GroupFn } from "../../trending/weekly-volume"
import * as refreshRoute from "../../../app/api/skills/trending/refresh/route"
import * as autoRefreshRoute from "../../../app/api/skills/trending/auto-refresh/route"

function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...o }
}
function structured(output: unknown): LLMResult {
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
const BRIEFS = { topics: [{ key: "T1", why: "x" }], crossDisciplineNote: "up" }
const fakeSearchFn: SearchFn = async (_source, query) => [
  paper({ title: `Fresh in ${query}`, date: "2026-07-10", year: 2026, citationCount: 3, venue: "ACL" }),
]

const NEURO = { id: "https://openalex.org/fields/28", label: "Neuroscience" }
const fieldGroupFn: TopicGroupFn = async () => [{ key: NEURO.id, label: NEURO.label, count: 500 }]

/** Recent window doubles T1's prior count so it clears the volume floor and ranks. */
function topicGroupFnFor(now: Date): TopicGroupFn {
  const windows = completeWindows(now)
  return async ({ fromDate }) =>
    fromDate === windows.recent.fromDate
      ? [{ key: "T1", label: "Auditory Attention Decoding", count: 40 }]
      : [{ key: "T1", label: "Auditory Attention Decoding", count: 10 }]
}
// The routes don't take a `now` override, so the grouper follows the real clock.
const topicGroupFn: TopicGroupFn = async (q) => topicGroupFnFor(new Date())(q)

describe("trending skill routes", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  it("POST /api/skills/trending/refresh streams per-discipline progress, results in a versioned TrendingBoard, and writes the cache to the test vault", async () => {
    const provider = new MockProvider([structured(BRIEFS)])
    const countFn: CountFn = async () => 1
    // Empty groupFn result → falls back to countFn (exercised on its own below); keeps this test off the real network.
    const groupFn: GroupFn = async () => []
    setSkillTestOverrides({ providerOverride: { strong: provider }, searchFn: fakeSearchFn, countFn, groupFn, topicGroupFn, fieldGroupFn })

    const fields = [
      { slug: "nlp", label: "NLP" },
      { slug: "bio", label: "Bio" },
    ]
    const res = await refreshRoute.POST(
      new Request("http://x/api/skills/trending/refresh", { method: "POST", body: JSON.stringify({ fields }) }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/x-ndjson")

    const progressEvents: unknown[] = []
    const result = (await readNdjson(res, (e) => progressEvents.push(e))) as TrendingBoard

    // Both labels roll up to the one anchor discipline → one progress event.
    expect(progressEvents).toEqual([{ type: "progress", field: "Neuroscience" }])

    expect(result.version).toBe(TRENDING_BOARD_VERSION)
    expect(result.anchors).toEqual([NEURO])
    expect(result.topics.map((t) => t.key)).toEqual(["T1"])
    expect(result.topics[0].why).toBe("x")
    expect(typeof result.generatedAt).toBe("string")

    // The route wrote through to the SAME storage the test injected via
    // setServerVaultForTests — verifies the route actually resolved the
    // server vault, not some other instance.
    const cached = await loadBoard(storage)
    expect(cached).not.toBeNull()
    expect(cached!.topics).toHaveLength(1)
    expect(await storage.read(DASHBOARD_CACHE_PATH)).not.toBeNull()
  })

  it("POST /api/skills/trending/refresh: a second refresh rewrites dashboard.json with an ADVANCED generatedAt", async () => {
    const countFn: CountFn = async () => 1
    const groupFn: GroupFn = async () => []
    const fields = [{ slug: "nlp", label: "NLP" }]
    const callRefresh = async (): Promise<TrendingBoard> => {
      // Fresh provider per call — MockProvider drains its queued responses.
      setSkillTestOverrides({ providerOverride: { strong: new MockProvider([structured(BRIEFS)]) }, searchFn: fakeSearchFn, countFn, groupFn, topicGroupFn, fieldGroupFn })
      const res = await refreshRoute.POST(
        new Request("http://x/api/skills/trending/refresh", { method: "POST", body: JSON.stringify({ fields }) }),
      )
      return (await readNdjson(res, () => undefined)) as TrendingBoard
    }

    const first = await callRefresh()
    const diskAfterFirst = await loadBoard(storage)
    expect(diskAfterFirst!.generatedAt).toBe(first.generatedAt)

    // A real clock gap so the second run's generatedAt is strictly later.
    await new Promise((r) => setTimeout(r, 5))
    const second = await callRefresh()
    const diskAfterSecond = await loadBoard(storage)

    // The manual refresh must have rewritten the cache, not silently no-op'd:
    // the persisted generatedAt tracks the second run and is strictly later.
    expect(diskAfterSecond!.generatedAt).toBe(second.generatedAt)
    expect(new Date(diskAfterSecond!.generatedAt).getTime()).toBeGreaterThan(
      new Date(diskAfterFirst!.generatedAt).getTime(),
    )
  })

  it("POST /api/skills/trending/refresh: a skill failure still terminates the stream with a usable (degraded) board, not a terminal error", async () => {
    const provider = new MockProvider([new Error("llm exploded")])
    const countFn: CountFn = async () => 1
    const groupFn: GroupFn = async () => []
    setSkillTestOverrides({ providerOverride: { strong: provider }, searchFn: fakeSearchFn, countFn, groupFn, topicGroupFn, fieldGroupFn })

    const res = await refreshRoute.POST(
      new Request("http://x/api/skills/trending/refresh", {
        method: "POST",
        body: JSON.stringify({ fields: [{ slug: "nlp", label: "NLP" }] }),
      }),
    )
    const result = (await readNdjson(res, () => undefined)) as TrendingBoard
    expect(result.topics[0].why).toBeNull()
    expect(result.topics[0].recentCount).toBe(40) // numbers survive the LLM failure
    expect(result.surveyError).toBeTruthy()
    // Even a degraded (survey-failed) refresh must persist the board to disk
    // with a fresh generatedAt — a failed survey never blocks the write.
    const cached = await loadBoard(storage)
    expect(cached).not.toBeNull()
    expect(cached!.topics[0].why).toBeNull()
    expect(cached!.surveyError).toBeTruthy()
    expect(cached!.generatedAt).toBe(result.generatedAt)
  })

  it("POST /api/skills/trending/refresh: setSkillTestOverrides countFn is wired through to a real per-week series in the result", async () => {
    const provider = new MockProvider([structured(BRIEFS)])
    const countFn: CountFn = async () => 7
    const groupFn: GroupFn = async () => [] // empty → falls back to countFn, exercising the countFn-only path this test targets
    setSkillTestOverrides({ providerOverride: { strong: provider }, searchFn: fakeSearchFn, countFn, groupFn, topicGroupFn, fieldGroupFn })

    const res = await refreshRoute.POST(
      new Request("http://x/api/skills/trending/refresh", {
        method: "POST",
        body: JSON.stringify({ fields: [{ slug: "nlp", label: "NLP" }] }),
      }),
    )
    const result = (await readNdjson(res, () => undefined)) as TrendingBoard
    expect(result.topics[0].weekly.length).toBe(8)
    expect(result.topics[0].weekly.every((v) => v.count === 7)).toBe(true)
  })

  it("POST /api/skills/trending/refresh: setSkillTestOverrides groupFn is wired through and preferred over countFn in the result", async () => {
    const provider = new MockProvider([structured(BRIEFS)])
    const countFn: CountFn = async () => {
      throw new Error("countFn must not be called when groupFn is injected and succeeds")
    }
    // groupFn echoes back a group keyed on the actual (real, un-mocked-clock)
    // fromDate it's called with, which is exactly weekStarts[0] for the
    // window fetchWeeklyVolume requests — so this stays correct regardless
    // of the real wall-clock date the test happens to run on.
    const groupFn: GroupFn = async (q) => [{ key: q.fromDate, count: 3 }]
    setSkillTestOverrides({ providerOverride: { strong: provider }, searchFn: fakeSearchFn, countFn, groupFn, topicGroupFn, fieldGroupFn })

    const res = await refreshRoute.POST(
      new Request("http://x/api/skills/trending/refresh", {
        method: "POST",
        body: JSON.stringify({ fields: [{ slug: "nlp", label: "NLP" }] }),
      }),
    )
    const result = (await readNdjson(res, () => undefined)) as TrendingBoard
    const weekly = result.topics[0].weekly
    expect(weekly.length).toBe(8)
    expect(weekly[0].count).toBe(3) // oldest week matches the grouped key
    expect(weekly.slice(1).every((v) => v.count === 0)).toBe(true) // rest zero-filled
  })

  it("POST /api/skills/trending/auto-refresh returns 'no-fields' on an empty vault (no tracked fields, no interests.md)", async () => {
    setSkillTestOverrides({ searchFn: fakeSearchFn, topicGroupFn, fieldGroupFn })
    const res = await autoRefreshRoute.POST(
      new Request("http://x/api/skills/trending/auto-refresh", { method: "POST", body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ result: "no-fields" })
    expect(await loadBoard(storage)).toBeNull()
  })

  it("POST /api/skills/trending/auto-refresh: 'refreshed' when fields are tracked and nothing is cached yet, using the injected provider (no network)", async () => {
    const { saveTrendingSettings } = await import("../../trending/settings")
    await saveTrendingSettings(storage, {
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "weekly",
      anchors: [],
      anchorsOverridden: false,
    })
    const provider = new MockProvider([structured(BRIEFS)])
    const countFn: CountFn = async () => 1
    const groupFn: GroupFn = async () => []
    setSkillTestOverrides({ providerOverride: { strong: provider }, searchFn: fakeSearchFn, countFn, groupFn, topicGroupFn, fieldGroupFn })

    const res = await autoRefreshRoute.POST(
      new Request("http://x/api/skills/trending/auto-refresh", { method: "POST", body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "refreshed" })
    expect(provider.calls.length).toBeGreaterThan(0)
    expect(await loadBoard(storage)).not.toBeNull()
  })
})
