import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as route from "@/app/api/recommendations/feedback/route"
import * as profile from "@/app/api/profile/route"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { undoChangeset } from "../../vault/mutations"
import { FEED_CACHE_PATH } from "../../skills/feed"
import { FEEDBACK_PATH } from "../../recommendation/contract"
import { recordRecommendationFeedback } from "../../recommendation/feedback"
import { exportVaultZip, importVaultZip } from "../../vault/export"

const key = "doi:10.1234/attention"
const answers = { name: "Ada", role: "Researcher", fields: "Neuroscience", topics: "Attention", feedPrefs: "Methods" }
const request = (body: unknown, origin = "http://127.0.0.1:3111") => new Request("http://127.0.0.1:3111/api/recommendations/feedback", {
  method: "POST", headers: { host: "127.0.0.1:3111", origin }, body: JSON.stringify(body),
})
describe("recommendation feedback persistence and controls", () => {
  let storage: MemoryVaultStorage
  beforeEach(async () => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
    await storage.write(FEED_CACHE_PATH, JSON.stringify({ generatedAt: "2026-09-04T00:00:00Z", items: [{
      paper: { ids: { doi: "10.1234/attention" }, title: "Auditory attention study", authors: [], fields: [], source: "pubmed" },
      score: 80, whyThis: "", whyYou: "", whyNow: "",
      ranking: { version: "weighted-v1", relevance: 100, recency: null, venue: null, feedbackAdjustment: 0, total: 75, assessment: null, matchedTopics: ["attention"], dateStatus: "unknown", confidence: "title-only", sources: ["pubmed"], queries: ["attention"] },
    }], costUsd: 0, strategy: { queries: [{ source: "pubmed", query: "attention", rationale: "core" }] }, stats: { retrieved: 1, ranked: 1 } }))
  })
  afterEach(() => setServerVaultForTests(null))
  it("persists server-owned topics, is idempotent, and supports History undo", async () => {
    const cache = await storage.read(FEED_CACHE_PATH)
    const response = await route.POST(request({ paperKey: key, reason: "not_my_topic" }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result).toMatchObject({ topics: ["attention"], title: "Auditory attention study" })
    expect(body.changesetId).toMatch(/^cs-/)
    expect((await (await route.POST(request({ paperKey: key, reason: "not_my_topic" }))).json()).changesetId).toBeNull()
    expect((await (await route.GET()).json()).entries).toHaveLength(1)
    await undoChangeset(storage, body.changesetId)
    expect(await storage.read(FEEDBACK_PATH)).toBeNull()
    expect(await storage.read(FEED_CACHE_PATH)).toBe(cache)
  })
  it("rejects forged fields, unsafe origins, unknown papers and traversal keys", async () => {
    expect((await route.POST(request({ paperKey: key, reason: "more_like_this", topics: ["invented"] }))).status).toBe(400)
    expect((await route.POST(request({ paperKey: key, reason: "more_like_this" }, "https://attacker.example"))).status).toBe(403)
    expect((await route.POST(request({ paperKey: "../../settings.json", reason: "dismiss" }))).status).toBe(404)
    expect((await route.POST(request({ paperKey: key, reason: "clicked" }))).status).toBe(400)
    expect(await storage.read(FEEDBACK_PATH)).toBeNull()
  })
  it("preserves corrupt feedback and returns a conflict", async () => {
    await storage.write(FEEDBACK_PATH, "broken {")
    expect((await route.POST(request({ paperKey: key, reason: "dismiss" }))).status).toBe(409)
    expect((await (await route.GET()).json()).warning).toContain("preserved")
    expect(await storage.read(FEEDBACK_PATH)).toBe("broken {")
  })
  it("concurrent feedback conflicts safely instead of losing a vote", async () => {
    const results = await Promise.all([route.POST(request({ paperKey: key, reason: "more_like_this" })), route.POST(request({ paperKey: key, reason: "not_my_topic" }))])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })
  it("persists preferences with revisions and preserves them for old clients", async () => {
    const created = await profile.POST(new Request("http://x/api/profile", { method: "POST", body: JSON.stringify(answers) }))
    const initial = (await created.json()).result
    const recommendations = { diversity: "exploratory", learnFromFeedback: false, resetAt: "2026-09-04T10:00:00.000Z" }
    const patch = (input: unknown) => profile.PATCH(new Request("http://x/api/profile", { method: "PATCH", body: JSON.stringify(input) }))
    const input = { ...answers, revision: initial.revision, avatarDataUrl: null, recommendations }
    const updated = await patch(input)
    expect(updated.status).toBe(200)
    const current = (await updated.json()).result
    expect((await (await profile.GET()).json()).profile.recommendations).toEqual(recommendations)
    expect((await patch(input)).status).toBe(409)
    const oldClient = await patch({ ...answers, name: "Ada Updated", revision: current.revision, avatarDataUrl: null })
    expect(oldClient.status).toBe(200)
    expect((await oldClient.json()).result.recommendations).toEqual(recommendations)
  })
  it("allows a fresh vote after reset", async () => {
    await recordRecommendationFeedback(storage, key, "more_like_this", new Date("2026-09-03T00:00:00Z"))
    await storage.write("profile.md", '## Recommendation settings\n\n{"diversity":"balanced","learnFromFeedback":true,"resetAt":"2026-09-04T00:00:00.000Z"}\n')
    const fresh = await recordRecommendationFeedback(storage, key, "more_like_this", new Date("2026-09-04T01:00:00Z"))
    expect(fresh.changesetId).not.toBeNull()
    expect(fresh.result.at).toBe("2026-09-04T01:00:00.000Z")
  })
  it("restores feedback and preferences through vault export/import without provider secrets", async () => {
    await profile.POST(new Request("http://x/api/profile", { method: "POST", body: JSON.stringify({ ...answers, recommendations: { diversity: "focused", learnFromFeedback: false, resetAt: null } }) }))
    await recordRecommendationFeedback(storage, key, "more_like_this")
    await storage.write(".scispark/settings.json", '{"secret":"do-not-export"}')
    const restored = new MemoryVaultStorage()
    await importVaultZip(restored, await exportVaultZip(storage))
    expect(await restored.read(FEEDBACK_PATH)).toBe(await storage.read(FEEDBACK_PATH))
    expect(await restored.read("profile.md")).toBe(await storage.read("profile.md"))
    expect(await restored.read(FEED_CACHE_PATH)).toBe(await storage.read(FEED_CACHE_PATH))
    expect(await restored.read(".scispark/settings.json")).toBeNull()
  })
  it("refines a thumbs down after cache rotation using a server snapshot, then undoes the reason", async () => {
    const initial = await (await route.POST(request({ paperKey: key, reason: "less_like_this" }))).json()
    await storage.delete(FEED_CACHE_PATH)
    const response = await route.POST(request({ paperKey: key, reason: "wrong_method", note: "I need adult EEG studies.", expectedRevision: initial.revision }))
    expect(response.status).toBe(200)
    const refined = await response.json()
    expect(refined.result).toMatchObject({ title: "Auditory attention study", topics: ["attention"], reason: "wrong_method", note: "I need adult EEG studies." })
    expect(refined.revision).not.toBe(initial.revision)
    expect((await route.POST(request({ paperKey: key, reason: "too_old", expectedRevision: initial.revision }))).status).toBe(409)
    await undoChangeset(storage, refined.changesetId)
    expect((await (await route.GET()).json()).entries[0].reason).toBe("less_like_this")
    await undoChangeset(storage, initial.changesetId)
    expect(await storage.read(FEEDBACK_PATH)).toBeNull()
  })
  it("validates free-text reasons and never accepts forged paper snapshots", async () => {
    for (const fields of [{ reason: "other" }, { reason: "other", note: "x".repeat(601) }, { reason: "too_old", abstract: "invented" }, { reason: "too_old", expectedRevision: "forged" }]) {
      expect((await route.POST(request({ paperKey: key, ...fields }))).status).toBe(400)
    }
    const response = await route.POST(request({ paperKey: key, reason: "other", note: "  Prefer empirical studies.  " }))
    expect((await response.json()).result.note).toBe("Prefer empirical studies.")
  })
})
