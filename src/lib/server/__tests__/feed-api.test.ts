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
        { type: "progress", stage: "strategy" },
        { type: "progress", stage: "retrieval" },
        { type: "progress", stage: "rank" },
        { type: "progress", stage: "rerank" },
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
