import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { resetConsolidationForTests, resetFeedRefreshForTests } from "../skill-singleflight-state"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMProvider, LLMRequest, LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { SearchFn } from "../../skills/feed"
import { loadFeed, FEED_CACHE_PATH, type FeedResult, type FeedStrategy } from "../../skills/feed"
import { logEvent } from "../../events/log"
import { saveTrendingSettings } from "../../trending/settings"
import * as feedRefreshRoute from "../../../app/api/skills/feed/refresh/route"
import * as consolidateRoute from "../../../app/api/skills/consolidate/route"
import { runConsolidation } from "../../skills/consolidation"
import { runHeartbeatTick } from "../../scheduler/heartbeat"
import { readLedger } from "../../runs/ledger"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"
import { DEFAULT_ENGINES } from "../../engines/contracts"

function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", abstract: "Sparse attention research", ...o }
}

function structured(json: unknown, model = "m", usage = { inputTokens: 10, outputTokens: 5 }): LLMResult {
  return { text: JSON.stringify(json), json, usage, model, provider: "anthropic", stopReason: "end_turn" }
}

const assessment = (index: number, grade: number) => ({ index, question: { grade, evidence: "Sparse attention" }, topic: { grade, evidence: "Sparse attention" }, approach: { grade: null, evidence: "" }, matches: [{ topic: "sparse attention", evidence: "Sparse attention" }], excluded: false })

const ONE_QUERY_STRATEGY: FeedStrategy = {
  queries: [{ source: "arxiv", query: "sparse attention", rationale: "core interest" }],
}

const fakeSearchFn: SearchFn = async () => [
  paper({ title: "Paper A", ids: { arxiv: "1" } }),
  paper({ title: "Paper B", ids: { arxiv: "2" } }),
]

async function seedOnboardedUserModel(storage: MemoryVaultStorage): Promise<void> {
  await storage.write("profile.md", "# Profile\n\nWorks on sparse attention.\n")
  await storage.write("interests.md", "# Interests\n\n## Active topics\n\n- sparse attention\n")
}

describe("feed + consolidation skill routes", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
    resetFeedRefreshForTests()
    resetConsolidationForTests()
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
    resetFeedRefreshForTests()
    resetConsolidationForTests()
  })

  describe("POST /api/skills/feed/refresh", () => {
    it("recovers a legacy assessment failure that was incorrectly recorded as successful without rewriting records", async () => {
      const cached: FeedResult = { generatedAt: "2026-09-29T07:48:21.037Z", items: [], strategy: ONE_QUERY_STRATEGY, stats: { retrieved: 49, ranked: 49 }, costUsd: null }
      await storage.write(FEED_CACHE_PATH, JSON.stringify(cached))
      const ledger = [{ orchestrator: "feed-refresh", trigger: "user", status: "ok", ts: "2026-09-29T07:51:49.024Z" },
        { orchestrator: "feed-refresh", trigger: "user", status: "ok", ts: "2026-09-29T08:44:34.892Z", meta: { itemCount: 12 } }].map(r => JSON.stringify(r)).join("\n")
      await storage.write(".scispark/runs/ledger.jsonl", ledger)
      await storage.write(".scispark/runs/run-1790671449194-abcd.json", JSON.stringify({ skill: "recommendation-assessment", status: "error", error: "PRIVATE_DIAGNOSTIC" }))
      const returned = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh"))
      await expect(readNdjson(returned, () => {})).rejects.toThrow("AI relevance assessment did not complete")
      expect(await storage.read(".scispark/runs/ledger.jsonl")).toBe(ledger)
      expect(await loadFeed(storage)).toEqual(cached)
    })
    it("rejects an unavailable local model before any search or completion", async () => {
      await seedOnboardedUserModel(storage)
      await saveSettings(storage, { ...DEFAULT_SETTINGS, engines: { ...DEFAULT_ENGINES, kind: "codex" } })
      const provider = Object.assign(new MockProvider([]), { preflight: async () => { throw new Error("The selected Codex model is unavailable") } })
      let searches = 0
      setSkillTestOverrides({ providerOverride: { strong: provider, fast: provider }, searchFn: async () => { searches++; return [] } })
      const started = await feedRefreshRoute.POST(new Request("http://x/api/skills/feed/refresh", { method: "POST", body: "{}" }))
      await expect(readNdjson(started, () => {})).rejects.toThrow("model is unavailable")
      const returned = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh"))
      await expect(readNdjson(returned, () => {})).rejects.toThrow("model is unavailable")
      expect((await readLedger(storage))[0]).toMatchObject({ status: "failed", reason: "The selected Codex model is unavailable" })
      expect(provider.calls).toHaveLength(0)
      expect(searches).toBe(0)
    })
    it("keeps a failed refresh visible after navigation and process state is cleared", async () => {
      await seedOnboardedUserModel(storage)
      const strong = new MockProvider([structured(ONE_QUERY_STRATEGY)])
      setSkillTestOverrides({ providerOverride: { strong }, searchFn: async () => [] })
      const started = await feedRefreshRoute.POST(new Request("http://x/api/skills/feed/refresh", { method: "POST", body: "{}" }))
      await expect(readNdjson(started, () => {})).rejects.toThrow("No eligible papers")
      resetFeedRefreshForTests()
      const returned = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh"))
      await expect(readNdjson(returned, () => {})).rejects.toThrow("No eligible papers")
      expect(strong.calls).toHaveLength(1)
    })

    it("records degraded assessment and keeps the old feed and failure visible on return", async () => {
      await seedOnboardedUserModel(storage)
      const cached: FeedResult = { generatedAt: "2026-09-28T12:00:00.000Z", items: [], strategy: ONE_QUERY_STRATEGY, stats: { retrieved: 0, ranked: 0 }, costUsd: 0 }
      await storage.write(FEED_CACHE_PATH, JSON.stringify(cached))
      const strong = new MockProvider([structured(ONE_QUERY_STRATEGY)])
      const fast = new MockProvider([new Error("Model rejected")])
      setSkillTestOverrides({ providerOverride: { strong, fast }, searchFn: fakeSearchFn })
      const started = await feedRefreshRoute.POST(new Request("http://x/api/skills/feed/refresh", { method: "POST", body: "{}" }))
      await expect(readNdjson(started, () => {})).rejects.toThrow("previous feed")
      expect(await loadFeed(storage)).toEqual(cached)
      expect((await readLedger(storage))[0]).toMatchObject({ status: "degraded", meta: { cacheUpdated: false } })
      resetFeedRefreshForTests()
      const returned = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh", { headers: { "x-feed-generated-at": cached.generatedAt } }))
      await expect(readNdjson(returned, () => {})).rejects.toThrow("previous feed")
      expect(strong.calls).toHaveLength(1)
      expect(fast.calls).toHaveLength(1)
    })
    it("reconnects with GET after the initiating stream disconnects without starting another pipeline", async () => {
      await seedOnboardedUserModel(storage)
      let release!: () => void
      let started!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const running = new Promise<void>((resolve) => { started = resolve })
      let calls = 0
      const provider: LLMProvider = { id: "anthropic", async complete() { calls++; started(); await gate; return structured(ONE_QUERY_STRATEGY) } }
      const fast = new MockProvider([structured({ assessments: [assessment(0, 4), assessment(1, 1)] })])
      setSkillTestOverrides({ providerOverride: { strong: provider, fast }, searchFn: fakeSearchFn })
      const first = await feedRefreshRoute.POST(new Request("http://x/api/skills/feed/refresh", { method: "POST", body: "{}" }))
      await running
      await first.body!.cancel()
      const observer = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh"))
      const events: Array<Record<string, unknown>> = []
      const result = readNdjson(observer, (event) => { events.push(event) })
      release()
      const feed = await result as FeedResult
      expect(feed.items).toHaveLength(1)
      expect(calls).toBe(1)
      expect(fast.calls).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: "progress", stage: "strategy", startedAt: expect.any(Number) })
      expect(await loadFeed(storage)).toEqual(feed)
      const idle = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh"))
      expect(await readNdjson(idle, () => {})).toBeNull()
      expect(calls).toBe(1)
    })

    it("GET never starts work when no refresh is active", async () => {
      await seedOnboardedUserModel(storage)
      const provider = new MockProvider([])
      setSkillTestOverrides({ providerOverride: { strong: provider, fast: provider } })
      const response = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh"))
      expect(await readNdjson(response, () => {})).toBeNull()
      expect(provider.calls).toHaveLength(0)
    })

    it("recovers a refresh that finished during navigation without replaying an unchanged cache", async () => {
      const cached: FeedResult = { generatedAt: "2026-09-29T12:00:00.000Z", items: [], strategy: ONE_QUERY_STRATEGY, stats: { retrieved: 0, ranked: 0 }, costUsd: 0 }
      await storage.write(FEED_CACHE_PATH, JSON.stringify(cached))
      const changed = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh", { headers: { "x-feed-generated-at": "2026-09-28T12:00:00.000Z" } }))
      expect(await readNdjson(changed, () => {})).toEqual(cached)
      const unchanged = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh", { headers: { "x-feed-generated-at": cached.generatedAt } }))
      expect(await readNdjson(unchanged, () => {})).toBeNull()
    })

    it("does not join another profile's refresh while its provider is running", async () => {
      await seedOnboardedUserModel(storage)
      let release!: () => void
      let started!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const running = new Promise<void>((resolve) => { started = resolve })
      let calls = 0
      const provider: LLMProvider = { id: "anthropic", async complete() { calls++; started(); await gate; return structured(ONE_QUERY_STRATEGY) } }
      setSkillTestOverrides({ providerOverride: { strong: provider }, searchFn: async () => [] })
      const first = await feedRefreshRoute.POST(new Request("http://x/api/skills/feed/refresh", { method: "POST", body: "{}" }))
      await running
      const other = new MemoryVaultStorage()
      await seedOnboardedUserModel(other)
      setServerVaultForTests(other)
      const observer = await feedRefreshRoute.GET(new Request("http://x/api/skills/feed/refresh"))
      expect(await readNdjson(observer, () => {})).toBeNull()
      const second = await feedRefreshRoute.POST(new Request("http://x/api/skills/feed/refresh", { method: "POST", body: "{}" }))
      // Both profiles must execute their own pipeline rather than sharing a result.
      const secondResult = readNdjson(second, () => {}).then(() => "success", (error: Error) => error.message)
      release()
      await expect(secondResult).resolves.toContain("No eligible papers were retrieved.")
      await expect(readNdjson(first, () => {})).rejects.toThrow("No eligible papers were retrieved.")
      expect(calls).toBe(2)
      expect(await other.read(FEED_CACHE_PATH)).toBeNull()
    })
    it("reads shared fields from the server vault, not a client-forged preference payload", async () => {
      await seedOnboardedUserModel(storage)
      await saveTrendingSettings(storage, { fields: [], cadence: "weekly", anchorsOverridden: true,
        anchors: [{ id: "28", label: "Neuroscience", subfieldIds: ["2805"] }],
      })
      const strong = new MockProvider([structured(ONE_QUERY_STRATEGY)])
      const fast = new MockProvider([structured({ assessments: [assessment(0, 4), assessment(1, 3)] })])
      setSkillTestOverrides({ providerOverride: { strong, fast }, searchFn: fakeSearchFn })
      const response = await feedRefreshRoute.POST(new Request("http://x/api/skills/feed/refresh", {
        method: "POST", body: JSON.stringify({ fieldPreferences: [{ label: "FORGED CLIENT INTEREST" }] }),
      }))
      const result = await readNdjson(response, () => {}) as FeedResult
      for (const provider of [strong, fast]) {
        expect(provider.calls[0].req.messages[1].content).toContain("Cognitive Neuroscience")
        expect(JSON.stringify(provider.calls)).not.toContain("FORGED CLIENT INTEREST")
      }
      expect(result.recommendation?.fieldPreferences?.[0].subfields[0].id).toBe("https://openalex.org/subfields/2805")
      expect(await loadFeed(storage)).toEqual(result)
    })
    it("streams funnel-stage progress, result parses as a FeedResult, and the cache is written to the test vault", async () => {
      await seedOnboardedUserModel(storage)

      const strongProvider = new MockProvider([
        structured(ONE_QUERY_STRATEGY),
        structured({
          items: [
            {
              index: 0,
              whyThis: "strong results",
              whyYou: "matches your interests",
              whyNow: "just released",
              tldr: "A sparse-attention method with strong empirical results.",
              tags: ["sparse attention"],
            },
          ],
        }),
      ])
      const fastProvider = new MockProvider([
        structured({
          assessments: [assessment(0, 4), assessment(1, 1)],
        }),
      ])
      setSkillTestOverrides({ providerOverride: { strong: strongProvider, fast: fastProvider }, searchFn: fakeSearchFn })

      const res = await feedRefreshRoute.POST(
        new Request("http://x/api/skills/feed/refresh", { method: "POST", body: JSON.stringify({}) }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("application/x-ndjson")

      const progressEvents: unknown[] = []
      const result = (await readNdjson(res, (e) => progressEvents.push(e))) as FeedResult

      expect(progressEvents).toEqual([
        { type: "progress", stage: "strategy", startedAt: expect.any(Number) },
        { type: "progress", stage: "retrieval", startedAt: expect.any(Number) },
        { type: "progress", stage: "rank", startedAt: expect.any(Number) },
        { type: "progress", stage: "rerank", startedAt: expect.any(Number) },
      ])

      expect(result.items).toHaveLength(1)
      expect(result.items[0].paper.title).toBe("Paper A")
      expect(result.strategy).toEqual(ONE_QUERY_STRATEGY)
      expect(result.stats).toEqual({ retrieved: 2, ranked: 2 })
      expect(typeof result.generatedAt).toBe("string")
      expect(result.costUsd).toBeGreaterThan(0)

      // The route wrote through to the SAME storage the test injected via
      // setServerVaultForTests — verifies the route actually resolved the
      // server vault, not some other instance.
      const cached = await loadFeed(storage)
      expect(cached).not.toBeNull()
      expect(cached).toEqual(result)
      expect(await storage.read(FEED_CACHE_PATH)).not.toBeNull()
    })

    it("a thrown error (e.g. zero candidates) terminates the stream with a terminal error, not a result", async () => {
      await seedOnboardedUserModel(storage)
      const strongProvider = new MockProvider([structured(ONE_QUERY_STRATEGY)])
      const emptySearchFn: SearchFn = async () => []
      setSkillTestOverrides({ providerOverride: { strong: strongProvider }, searchFn: emptySearchFn })

      const res = await feedRefreshRoute.POST(
        new Request("http://x/api/skills/feed/refresh", { method: "POST", body: JSON.stringify({}) }),
      )
      await expect(readNdjson(res, () => undefined)).rejects.toThrow(
        "No eligible papers were retrieved.",
      )
      expect(await storage.read(FEED_CACHE_PATH)).toBeNull()
    })

    it("joins concurrent refresh requests to one provider pipeline", async () => {
      await seedOnboardedUserModel(storage)

      let releaseStrategy!: () => void
      let signalStarted!: () => void
      const strategyGate = new Promise<void>((resolve) => { releaseStrategy = resolve })
      const strategyStarted = new Promise<void>((resolve) => { signalStarted = resolve })
      const strongCalls: LLMRequest[] = []
      const strongProvider: LLMProvider = {
        id: "anthropic",
        async complete(_model, request) {
          strongCalls.push(request)
          if (strongCalls.length === 1) {
            signalStarted()
            await strategyGate
            return structured(ONE_QUERY_STRATEGY)
          }
          return structured({
            items: [{
              index: 0,
              whyThis: "strong results",
              whyYou: "matches your interests",
              whyNow: "just released",
              tldr: "A concise result.",
              tags: ["attention"],
            }],
          })
        },
      }
      const fastProvider = new MockProvider([
        structured({ assessments: [assessment(0, 4), assessment(1, 1)] }),
      ])
      setSkillTestOverrides({
        providerOverride: { strong: strongProvider, fast: fastProvider },
        searchFn: fakeSearchFn,
      })

      const firstResponse = await feedRefreshRoute.POST(
        new Request("http://x/api/skills/feed/refresh", { method: "POST", body: JSON.stringify({}) }),
      )
      await strategyStarted
      const secondResponse = await feedRefreshRoute.POST(
        new Request("http://x/api/skills/feed/refresh", { method: "POST", body: JSON.stringify({}) }),
      )
      releaseStrategy()

      const [first, second] = await Promise.all([
        readNdjson(firstResponse, () => undefined),
        readNdjson(secondResponse, () => undefined),
      ])
      expect(second).toEqual(first)
      expect(strongCalls).toHaveLength(1) // planning only, joined across requests
      expect(fastProvider.calls).toHaveLength(1)
    })
  })

  describe("POST /api/skills/consolidate", () => {
    it("does not duplicate paid work when a scheduled consolidation overlaps the API", async () => {
      await seedOnboardedUserModel(storage)
      for (let i = 0; i < 25; i++) await logEvent(storage, { type: "search", source: "arxiv", query: `query-${i}` })
      const output = structured({ profile: await storage.read("profile.md"), interests: await storage.read("interests.md"), feedback: "# Feedback\n" })
      let entered!: () => void
      const started = new Promise<void>((resolve) => { entered = resolve })
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      const inner = new MockProvider([output, output])
      const provider: LLMProvider = { id: inner.id, complete: async (model, request) => {
        entered()
        await held
        return inner.complete(model, request)
      } }
      setSkillTestOverrides({ providerOverride: { fast: provider } })
      const scheduled = runHeartbeatTick({ storage, topWorksFn: async () => [], jobs: {
        maybeAutoRefreshTrending: async () => "fresh",
        runConsolidation: (vault, opts) => runConsolidation(vault, { ...opts, providerOverride: { fast: provider } }),
        runLintDeterministic: async () => ({ findings: [], reviewIds: [] }),
      } })
      await started
      const manual = consolidateRoute.POST(new Request("http://x/api/skills/consolidate", { method: "POST", body: JSON.stringify({}) }))
      release()
      const [, response] = await Promise.all([scheduled, manual])
      expect(response.status).toBe(200)
      expect((await response.json()).result.status).toBe("skipped")
      expect(inner.calls).toHaveLength(1)
    })
    it("returns status 'skipped' with no LLM calls when consolidation isn't due yet", async () => {
      const provider = new MockProvider([])
      setSkillTestOverrides({ providerOverride: { fast: provider } })

      const res = await consolidateRoute.POST(
        new Request("http://x/api/skills/consolidate", { method: "POST", body: JSON.stringify({}) }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { result: { status: string } }
      expect(body.result.status).toBe("skipped")
      expect(provider.calls).toHaveLength(0)
    })

    it("applies a changeset and rewrites the user-model pages once enough events have accumulated", async () => {
      await seedOnboardedUserModel(storage)
      for (let i = 0; i < 25; i++) {
        await logEvent(storage, { type: "search", source: "arxiv", query: `query-${i}` })
      }

      const newProfile = "# Profile\n\nWorks on sparse attention (consolidated).\n"
      const newInterests = "# Interests\n\n## Active topics\n\n- sparse attention (5 ingests this week)\n"
      const newFeedback = "# Feedback\n"
      const provider = new MockProvider([structured({ profile: newProfile, interests: newInterests, feedback: newFeedback })])
      setSkillTestOverrides({ providerOverride: { fast: provider }, searchFn: fakeSearchFn })

      const res = await consolidateRoute.POST(
        new Request("http://x/api/skills/consolidate", { method: "POST", body: JSON.stringify({}) }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        result: { status: string; changesetId?: string; costUsd?: number }
      }
      expect(body.result.status).toBe("applied")
      expect(body.result.changesetId).toBeTruthy()
      expect(provider.calls).toHaveLength(1)

      expect(await storage.read("profile.md")).toBe(newProfile)
      expect(await storage.read("interests.md")).toBe(newInterests)
    })
  })
})
