import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { TopicGroupFn, TopWorksFn } from "../../papers/node-search"
import { loadBoard, DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION, type TrendingBoard } from "../../trending/dashboard"
import { completeWindows } from "../../trending/topics"
import type { CountFn } from "../../trending/counts"
import { REFRESH_FAILURE_PATH } from "../../trending/auto-refresh"
import { readLedger } from "../../runs/ledger"
import * as refreshRoute from "../../../app/api/skills/trending/refresh/route"
import * as autoRefreshRoute from "../../../app/api/skills/trending/auto-refresh/route"

function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...o }
}
function structured(output: unknown): LLMResult {
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
const BRIEFS = { topics: [{ key: "T1", why: "x" }], crossDisciplineNote: "up" }
/**
 * A fake entity-scoped works retriever: answers whatever scope it is handed, so
 * the route tests never touch the network for the board's topic or breakout
 * papers. The record is dated inside whichever window is asked for.
 */
const fakeTopWorksFn: TopWorksFn = async (q) => [
  paper({ title: `Fresh in ${q.topicId ?? q.fieldId ?? q.query ?? "?"}`, date: q.toDate, year: 2026, citationCount: 3, venue: "ACL" }),
]

const NEURO = { id: "https://openalex.org/fields/28", label: "Neuroscience" }
const fieldGroupFn: TopicGroupFn = async () => [{ key: NEURO.id, label: NEURO.label, count: 500 }]

/**
 * Only the RECENT window is grouped now (prior counts are looked up through
 * countFn), so anything else must come back empty.
 */
function topicGroupFnFor(now: Date): TopicGroupFn {
  const windows = completeWindows(now)
  return async ({ fromDate }) =>
    fromDate === windows.recent.fromDate ? [{ key: "T1", label: "Auditory Attention Decoding", count: 40 }] : []
}
// The routes don't take a `now` override, so the grouper follows the real clock.
const topicGroupFn: TopicGroupFn = async (q) => topicGroupFnFor(new Date())(q)

/**
 * The default count fake: a topic-scoped request is a prior-count lookup and
 * must clear MIN_PRIOR_COUNT (the symmetric volume floor) or the row is dropped
 * as noise; an unscoped request is the anchor's corpus size, the denominator
 * every share is scaled by.
 */
const countFn: CountFn = async (q) => (q.topicId === undefined ? 1000 : 10)

/** True for a whole-prior-window, topic-scoped request — the leaderboard's prior-count lookup. */
function isPriorLookup(q: { fromDate: string; toDate: string; topicId?: string }): boolean {
  const windows = completeWindows(new Date())
  return q.topicId !== undefined && q.fromDate === windows.prior.fromDate && q.toDate === windows.prior.toDate
}

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
    setSkillTestOverrides({ providerOverride: { strong: provider }, topWorksFn: fakeTopWorksFn, countFn, topicGroupFn, fieldGroupFn })

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
    const fields = [{ slug: "nlp", label: "NLP" }]
    const callRefresh = async (): Promise<TrendingBoard> => {
      // Fresh provider per call — MockProvider drains its queued responses.
      setSkillTestOverrides({ providerOverride: { strong: new MockProvider([structured(BRIEFS)]) }, topWorksFn: fakeTopWorksFn, countFn, topicGroupFn, fieldGroupFn })
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
    setSkillTestOverrides({ providerOverride: { strong: provider }, topWorksFn: fakeTopWorksFn, countFn, topicGroupFn, fieldGroupFn })

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

  it("POST /api/skills/trending/refresh: setSkillTestOverrides countFn is wired through to the board's prior counts", async () => {
    const provider = new MockProvider([structured(BRIEFS)])
    // 7 for a prior-count lookup, 1 for the anchor-wide recent total — the only
    // two things the board counts. There is no per-topic series any more, so a
    // countFn that answered a third kind of request would mean one crept back.
    const countFn: CountFn = async (q) => {
      if (isPriorLookup(q)) return 7
      if (q.topicId !== undefined) throw new Error("no topic-scoped count other than the prior lookup should be issued")
      return 1
    }
    setSkillTestOverrides({ providerOverride: { strong: provider }, topWorksFn: fakeTopWorksFn, countFn, topicGroupFn, fieldGroupFn })

    const res = await refreshRoute.POST(
      new Request("http://x/api/skills/trending/refresh", {
        method: "POST",
        body: JSON.stringify({ fields: [{ slug: "nlp", label: "NLP" }] }),
      }),
    )
    const result = (await readNdjson(res, () => undefined)) as TrendingBoard
    expect(result.topics[0].priorCount).toBe(7)
    expect(result.topics[0].recentCount).toBe(40)
    expect(result.overview.totalRecent).toBe(1)
  })

  it("POST /api/skills/trending/auto-refresh returns 'no-fields' on an empty vault (no tracked fields, no interests.md)", async () => {
    setSkillTestOverrides({ topWorksFn: fakeTopWorksFn, topicGroupFn, fieldGroupFn })
    const res = await autoRefreshRoute.POST(
      new Request("http://x/api/skills/trending/auto-refresh", { method: "POST", body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ result: "no-fields" })
    expect(await loadBoard(storage)).toBeNull()
  })

  it("POST /api/skills/trending/auto-refresh returns 'backoff' and records a skipped ledger entry when a recent failure marker is still within its backoff window", async () => {
    const { saveTrendingSettings } = await import("../../trending/settings")
    await saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [], anchorsOverridden: false })
    // A failure marker recorded "just now" with consecutiveFailures: 1 (30min backoff) —
    // real wall-clock elapsed since writing it is a few ms, well under the window.
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: new Date().toISOString(), consecutiveFailures: 1, lastError: "boom" }),
    )
    setSkillTestOverrides({ topWorksFn: fakeTopWorksFn })

    const res = await autoRefreshRoute.POST(
      new Request("http://x/api/skills/trending/auto-refresh", { method: "POST", body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "backoff" })

    const records = await readLedger(storage)
    const record = records.find((r) => r.orchestrator === "trending-refresh")
    expect(record).toBeDefined()
    expect(record?.status).toBe("skipped")
    expect(record?.reason).toBe("backoff")
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
    setSkillTestOverrides({ providerOverride: { strong: provider }, topWorksFn: fakeTopWorksFn, countFn, topicGroupFn, fieldGroupFn })

    const res = await autoRefreshRoute.POST(
      new Request("http://x/api/skills/trending/auto-refresh", { method: "POST", body: JSON.stringify({}) }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "refreshed" })
    expect(provider.calls.length).toBeGreaterThan(0)
    expect(await loadBoard(storage)).not.toBeNull()
  })
})
