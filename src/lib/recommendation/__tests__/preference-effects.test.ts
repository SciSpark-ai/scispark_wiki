import { describe, expect, it } from "vitest"
import { DEFAULT_RECOMMENDATION_PREFERENCES as prefs, ScoreBreakdownSchema, type Assessment, type FeedbackEntry, type MemoryMatch } from "../contract"
import { scoreCandidate, selectRecommendations, type Candidate } from "../engine"
import { selectFeedPreferenceMemory } from "../../usermodel/feed-memory"

const now = new Date("2026-09-05T00:00:00Z")
const vote = (reason: FeedbackEntry["reason"], key: string = reason, extra: Partial<FeedbackEntry> = {}): FeedbackEntry => ({
  paperKey: key, title: "Auditory attention measured using EEG in children", topics: ["auditory attention"],
  abstract: "Auditory attention measured using EEG in children.", reason, at: now.toISOString(), ...extra,
})
const paper = (title = "Auditory attention study"): Candidate => ({
  paper: { ids: { doi: title }, title, abstract: "Auditory attention measured using EEG in children.", authors: [], fields: [], source: "pubmed", date: "2026-08-29" },
  queries: ["auditory attention"], sources: ["pubmed"],
})
const match = (paperKey: string, extra: Partial<MemoryMatch> = {}): MemoryMatch => ({
  paperKey, facet: "example", effect: "boost", match: "close",
  candidateEvidence: "Auditory attention", memoryEvidence: "Auditory attention", ...extra,
})
const assessment = (memoryMatches: MemoryMatch[], grade = 3): Assessment => ({
  index: 0, question: { grade, evidence: "Auditory attention" }, topic: { grade, evidence: "Auditory attention" },
  approach: { grade: null, evidence: "" }, matches: [], excluded: false, memoryMatches,
})
const context = (entries: FeedbackEntry[], options = prefs) => ({
  text: "Auditory attention", topics: ["auditory attention"], hasQuestion: true, hasApproach: false,
  memories: selectFeedPreferenceMemory(entries, options, now),
})
const score = (entries: FeedbackEntry[], matches: MemoryMatch[], options = prefs) => scoreCandidate(paper(), assessment(matches), context(entries, options), [], now)!.ranking

describe("grounded, reason-specific preference effects", () => {
  it("changes ranking from one positive or negative example without a two-vote wait", () => {
    expect(score([vote("more_like_this")], [match("more_like_this")]).feedbackAdjustment).toBe(8)
    expect(score([vote("less_like_this")], [match("less_like_this", { effect: "reduce" })]).feedbackAdjustment).toBe(-4)
    expect(score([vote("not_my_topic")], [match("not_my_topic", { facet: "topic", effect: "reduce" })]).feedbackAdjustment).toBe(-8)
  })
  it("applies method feedback even without any method named in the profile", () => {
    const result = score([vote("wrong_method")], [match("wrong_method", { facet: "approach", effect: "reduce", candidateEvidence: "EEG in children", memoryEvidence: "EEG in children" })])
    expect(result.relevance).toBe(75)
    expect(result.feedbackAdjustment).toBe(-8)
    expect(result.assessment?.approach.grade).toBeNull()
    expect(result.memoryEffects?.[0]).toMatchObject({ reason: "wrong_method", facet: "approach", at: now.toISOString() })
    expect(score([vote("wrong_method")], [match("wrong_method", { facet: "topic", effect: "reduce" })]).feedbackAdjustment).toBe(0)
  })
  it("changes only recency for age feedback and does not compound multiple age votes", () => {
    const ageMatch = match("too_old", { facet: "recency", effect: "freshness" })
    const result = score([vote("too_old")], [ageMatch])
    expect(result).toMatchObject({ relevance: 75, feedbackAdjustment: 0, recencyHalfLifeDays: 7, recency: 50 })
    expect(result.memoryEffects?.[0].adjustment).toBe(-4.1)
    expect(score([vote("too_old")], []).recencyHalfLifeDays).toBe(14)
    const multiple = score([vote("too_old"), vote("too_old", "second")], [ageMatch, { ...ageMatch, paperKey: "second" }])
    expect(multiple.recency).toBe(50)
    expect(multiple.memoryEffects?.[1].adjustment).toBe(0)
    const unknown = paper()
    delete unknown.paper.date
    expect(scoreCandidate(unknown, assessment([ageMatch]), context([vote("too_old")]), [], now)?.ranking).toMatchObject({ recency: null, recencyHalfLifeDays: 14, memoryEffects: [] })
  })
  it("rejects unknown memories, invented evidence, wrong reason semantics and duplicate votes", () => {
    const entries = [vote("more_like_this")]
    const proposals = [match("unknown"), match("more_like_this", { memoryEvidence: "Fabricated snapshot" }), match("more_like_this", { candidateEvidence: "Unstated discovery" })]
    expect(score(entries, proposals).memoryEffects).toEqual([])
    expect(score(entries, [match("more_like_this", { effect: "reduce" })]).feedbackAdjustment).toBe(0)
    const result = score(entries, [match("more_like_this"), match("more_like_this")])
    expect(result.memoryEffects).toHaveLength(1)
    expect(result.feedbackAdjustment).toBe(8)
    expect(result.assessment?.memoryMatches).toHaveLength(1)
  })
  it("requires verbatim user-note support for a custom preference", () => {
    const entry = vote("other", "other", { note: "I prefer studies using EEG in children." })
    const good = match("other", { facet: "approach", memoryEvidence: "prefer studies using EEG in children" })
    expect(score([entry], [good]).feedbackAdjustment).toBe(8)
    expect(score([entry], [{ ...good, memoryEvidence: "Auditory attention" }]).feedbackAdjustment).toBe(0)
    expect(score([vote("other")], [match("other", { facet: "custom" })]).feedbackAdjustment).toBe(0)
  })
  it("respects disable/reset/expiry and weakens older or less certain evidence", () => {
    const entry = vote("more_like_this")
    const matches = [match(entry.paperKey)]
    expect(score([entry], matches, { ...prefs, learnFromFeedback: false }).feedbackAdjustment).toBe(0)
    expect(score([entry], matches, { ...prefs, resetAt: now.toISOString() }).feedbackAdjustment).toBe(0)
    expect(score([{ ...entry, at: "2026-08-06T00:00:00Z" }], matches).feedbackAdjustment).toBe(4)
    expect(score([{ ...entry, at: "2025-01-01T00:00:00Z" }], matches).feedbackAdjustment).toBe(0)
    expect(score([entry], [match(entry.paperKey, { match: "related" })]).feedbackAdjustment).toBe(4)
  })
  it("caps aggregate feedback, balances contradictions, and never rescues irrelevant papers", () => {
    const entries = [vote("more_like_this", "a"), vote("more_like_this", "b"), vote("more_like_this", "c")]
    const capped = score(entries, entries.map((entry) => match(entry.paperKey)))
    expect(capped.feedbackAdjustment).toBe(20)
    expect(capped.memoryEffects?.reduce((sum, effect) => sum + effect.adjustment, 0)).toBe(20)
    const opposing = [vote("more_like_this"), vote("not_my_topic")]
    expect(score(opposing, [match("more_like_this"), match("not_my_topic", { facet: "topic", effect: "reduce" })]).feedbackAdjustment).toBe(0)
    expect(scoreCandidate(paper(), assessment([match("a")], 1), context(entries), [], now)).toBeNull()
  })
  it("moves a matching paper up or down against the same fixed candidate pool", () => {
    const makePool = (entries: FeedbackEntry[], matches: MemoryMatch[]) => [
      scoreCandidate(paper("A matched paper"), assessment(matches), context(entries), [], now)!,
      scoreCandidate(paper("B alternative"), assessment([]), context(entries), [], now)!,
    ]
    const disliked = selectRecommendations(makePool([vote("wrong_method")], [match("wrong_method", { facet: "approach", effect: "reduce", candidateEvidence: "EEG in children", memoryEvidence: "EEG in children" })]), prefs)
    expect(disliked[0].paper.title).toBe("B alternative")
    const liked = selectRecommendations(makePool([vote("more_like_this")], [match("more_like_this")]), prefs)
    expect(liked[0].paper.title).toBe("A matched paper")
    expect(ScoreBreakdownSchema.parse(liked[0].ranking)).toEqual(liked[0].ranking)
  })
})
