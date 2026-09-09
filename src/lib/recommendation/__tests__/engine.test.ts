import { describe, expect, it } from "vitest"
import { DEFAULT_RECOMMENDATION_PREFERENCES as prefs, type Assessment, type FeedbackEntry } from "../contract"
import { candidateText, interleaveCandidates, learnTopicAdjustments, publicationDate, recencyScore, retrieveRecommendationCandidates, scoreCandidate, selectRecommendations, type Candidate } from "../engine"
import { PaperSourceError, type PaperRecord } from "../../papers/types"

const now = new Date("2026-09-04T00:00:00Z")
const make = (title = "Auditory attention study", extra: Partial<PaperRecord> = {}): Candidate => ({ paper: { ids: {}, title, abstract: "Auditory attention measured using EEG in children.", authors: [], fields: [], source: "pubmed", date: "2026-09-04", ...extra }, sources: ["pubmed"], queries: ["auditory attention"] })
const assessment = (index = 0, grade = 4): Assessment => ({ index, question: { grade, evidence: "Auditory attention" }, topic: { grade, evidence: "Auditory attention" }, approach: { grade, evidence: "EEG in children" }, matches: [{ topic: "auditory attention", evidence: "Auditory attention" }], excluded: false })
const context = { text: "auditory attention", topics: ["auditory attention"], hasQuestion: true, hasApproach: true }

describe("reusable recommendation scoring", () => {
  it("applies the published weights and grounded grade rubric", () => {
    const item = scoreCandidate(make(), assessment(), context, [], now)!
    expect(item.ranking).toMatchObject({ relevance: 100, recency: 100, venue: null, total: 95, matchedTopics: ["auditory attention"] })
    expect(scoreCandidate(make(), assessment(0, 1), context, [], now)).toBeNull()
  })
  it("renormalizes unspecified preferences, not unsupported evidence", () => {
    const a = assessment()
    a.question.grade = null
    a.approach.grade = null
    expect(scoreCandidate(make(), a, { ...context, hasQuestion: false, hasApproach: false }, [], now)?.ranking.relevance).toBe(100)
    a.topic.evidence = "A fabricated discovery never stated in this paper"
    expect(scoreCandidate(make(), a, context, [], now)).toBeNull()
  })
  it("rejects unknown topic matches, excluded items, invalid/future venue metrics", () => {
    const a = assessment()
    a.matches = [{ topic: "quantum physics", evidence: "Auditory attention" }]
    expect(scoreCandidate(make(), a, context, [], now)?.ranking.matchedTopics).toEqual([])
    expect(scoreCandidate(make(), { ...a, excluded: true }, context, [], now)).toBeNull()
    const venue = { score: 100, source: "licensed dataset", metric: "field percentile", year: 2026, cohort: "neuroscience journals", url: "https://example.org/metrics" }
    expect(scoreCandidate(make(), assessment(), context, [], now, venue)?.ranking.total).toBe(100)
    expect(scoreCandidate(make(), assessment(), context, [], now, { ...venue, year: 2027 })?.ranking.venue).toBeNull()
  })
  it("uses actual dates, a 14-day half-life, and bounded abstract text", () => {
    expect(recencyScore(make("x", { date: "2026-08-21" }).paper, now)).toBe(50)
    expect(scoreCandidate(make("Auditory attention", { date: "2026-08-21" }), assessment(), context, [], new Date("2026-09-04T23:00:00Z"))?.ranking.dateStatus).toBe("recent")
    expect(recencyScore(make("x", { date: "2026-09-05" }).paper, now)).toBeNull()
    expect(publicationDate(make("x", { date: "2026-02-30" }).paper)).toBeNull()
    expect(recencyScore(make("x", { date: undefined, year: 2026 }).paper, now)).toBeNull()
    expect(candidateText(make("title", { abstract: "x".repeat(3000) }).paper)).toHaveLength(2006)
  })
  it("balances queries and merges shared aliases without conflating conflicting DOIs", () => {
    const groups = [[make("A", { ids: { doi: "10.1/a" } }), make("B")], [make("C"), make("A", { ids: { doi: "10.1/a", pmid: "123" }, source: "openalex" })]]
    expect(interleaveCandidates(groups, new Set()).map((item) => item.paper.title)).toEqual(["A", "C", "B"])
    expect(interleaveCandidates(groups, new Set(["pmid:123"])).map((item) => item.paper.title)).toEqual(["C", "B"])
    expect(interleaveCandidates([[make("same", { ids: { doi: "10/a" } })], [make("same", { ids: { doi: "10/b" } })]], new Set())).toHaveLength(2)
  })
  it("skips absent identifier aliases returned by source adapters without losing valid exclusions", () => {
    const groups = [[make("PubMed result", { ids: { pmid: "123", doi: undefined, arxiv: undefined } }),
      make("Title-only result", { ids: { doi: undefined, s2: "" } })]]
    expect(interleaveCandidates(groups, new Set()).map(({ paper }) => paper.title)).toEqual(["PubMed result", "Title-only result"])
    expect(interleaveCandidates(groups, new Set(["pmid:123"])).map(({ paper }) => paper.title)).toEqual(["Title-only result"])
    expect(interleaveCandidates(groups, new Set(["doi:undefined", "s2:"]))).toHaveLength(2)
  })
  it("makes diversity observable without selecting irrelevant items", () => {
    const a = scoreCandidate(make("Auditory attention EEG"), assessment(), context, [], now)!
    const b = scoreCandidate(make("Auditory attention EEG replication"), assessment(), context, [], now)!
    const c = scoreCandidate(make("Brain imaging language"), assessment(), context, [], now)!
    c.ranking.matchedTopics = ["language"]
    c.ranking.total = 89
    expect(selectRecommendations([a, b, c], { ...prefs, diversity: "focused" }, 2)[1]).toBe(b)
    expect(selectRecommendations([a, b, c], { ...prefs, diversity: "exploratory" }, 2)[1]).toBe(c)
    expect(selectRecommendations([c, b, a], prefs)).toEqual(selectRecommendations([a, b, c], prefs))
  })
  it("bounds older retrieval to 90 days, filters future records and reports failures without secrets", async () => {
    const dates: string[] = []
    const output = await retrieveRecommendationCandidates({ queries: [
      { source: "pubmed", query: "a", rationale: "core" }, { source: "s2", query: "b", rationale: "core" },
    ] }, async (source, _query, _limit, opts) => {
      if (source === "s2") throw new Error("secret-provider-key")
      dates.push(opts!.fromDate!)
      return [make("current").paper, make("future", { date: "2027-01-01" }).paper, make("old", { date: "2020-01-01" }).paper]
    }, new Set(), now)
    expect(dates).toEqual(["2026-08-21", "2026-06-06"])
    expect(output.candidates.map((item) => item.paper.title)).toEqual(["current"])
    expect(output.retrieval.some((entry) => entry.error)).toBe(true)
    expect(JSON.stringify(output)).not.toContain("secret-provider-key")
  })
  it("returns from a stalled source within its deadline", async () => {
    const signals: AbortSignal[] = []
    const output = await retrieveRecommendationCandidates({ queries: [{ source: "s2", query: "x", rationale: "core" }] }, (_source, _query, _limit, opts) => {
      signals.push(opts!.signal!)
      return new Promise(() => {})
    }, new Set(), now, { timeoutMs: 5 })
    expect(output.candidates).toEqual([])
    expect(output.retrieval.every((entry) => entry.error === "Search timed out; some papers could not be retrieved.")).toBe(true)
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
  it.each([429, 403, 502])("reports safe source status %s without secrets or query URLs", async (status) => {
    const output = await retrieveRecommendationCandidates({ queries: [{ source: "s2", query: "x", rationale: "core" }] }, async () => {
      throw new PaperSourceError("https://example.test?api_key=secret-key", status)
    }, new Set(), now)
    expect(output.retrieval[0].error).toMatch(status === 429 ? /Rate limited/ : status === 403 ? /Access denied/ : /Search failed/)
    expect(JSON.stringify(output)).not.toContain("secret-key")
  })
})

describe("bounded feedback learning", () => {
  const vote = (id: string, reason: FeedbackEntry["reason"] = "more_like_this", at = now.toISOString()): FeedbackEntry => ({ paperKey: id, title: id, topics: ["auditory attention"], reason, at })
  it("requires two independent papers, never counts repeated clicks, and caps influence", () => {
    expect(learnTopicAdjustments([vote("a"), vote("a")], prefs, now)).toEqual([])
    const entries = Array.from({ length: 10 }, (_, index) => vote(String(index)))
    expect(learnTopicAdjustments(entries, prefs, now)[0]).toMatchObject({ adjustment: 5, examples: 10 })
    expect(scoreCandidate(make(), assessment(), context, learnTopicAdjustments(entries, prefs, now), now)?.ranking.feedbackAdjustment).toBe(5)
  })
  it("ignores age/knowledge/dismiss signals for topic learning and respects disable/reset", () => {
    expect(learnTopicAdjustments([vote("a", "too_old"), vote("b", "already_know"), vote("c", "dismiss")], prefs, now)).toEqual([])
    const entries = [vote("a"), vote("b")]
    expect(learnTopicAdjustments(entries, { ...prefs, learnFromFeedback: false }, now)).toEqual([])
    expect(learnTopicAdjustments(entries, { ...prefs, resetAt: now.toISOString() }, now)).toEqual([])
  })
  it("decays with age; latest feedback can reverse an earlier vote", () => {
    const fresh = learnTopicAdjustments([vote("a"), vote("b")], prefs, now)[0].adjustment
    const old = learnTopicAdjustments([vote("a", "more_like_this", "2026-08-05T00:00:00Z"), vote("b", "more_like_this", "2026-08-05T00:00:00Z")], prefs, now)[0].adjustment
    expect(old).toBeLessThan(fresh)
    expect(learnTopicAdjustments([vote("a"), vote("b"), vote("a", "not_my_topic")], prefs, now)[0].adjustment).toBe(0)
  })
})
