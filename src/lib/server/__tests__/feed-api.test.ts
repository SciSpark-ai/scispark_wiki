import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { readNdjson } from "../ndjson"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { SearchFn } from "../../skills/feed"
import { loadFeed, FEED_CACHE_PATH, type FeedResult, type FeedStrategy } from "../../skills/feed"
import { logEvent } from "../../events/log"
import * as feedRefreshRoute from "../../../app/api/skills/feed/refresh/route"
import * as consolidateRoute from "../../../app/api/skills/consolidate/route"

function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...o }
}

function structured(json: unknown, model = "m", usage = { inputTokens: 10, outputTokens: 5 }): LLMResult {
  return { text: JSON.stringify(json), json, usage, model, provider: "anthropic", stopReason: "end_turn" }
}

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
  })
  afterEach(() => {
    setServerVaultForTests(null)
    setSkillTestOverrides()
  })

  describe("POST /api/skills/feed/refresh", () => {
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
          scores: [
            { index: 0, score: 90 },
            { index: 1, score: 40 },
          ],
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
        "no candidates retrieved — try adjusting profile.md or interests.md",
      )
      expect(await storage.read(FEED_CACHE_PATH)).toBeNull()
    })
  })

  describe("POST /api/skills/consolidate", () => {
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
