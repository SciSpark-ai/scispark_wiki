import { describe, expect, it } from "vitest"
import { selectFeedPreferenceMemory } from "../feed-memory"
import { DEFAULT_RECOMMENDATION_PREFERENCES as prefs, type FeedbackEntry } from "../../recommendation/contract"

const now = new Date("2026-09-05T00:00:00Z")
const entry = (reason: FeedbackEntry["reason"], key: string = reason): FeedbackEntry => ({ paperKey: key, title: "Auditory attention EEG", topics: ["attention"], reason, at: now.toISOString(), abstract: "EEG in children.", note: "I need adult studies." })

describe("feed-specific user memory", () => {
  it("uses a single explicit example immediately, including newly liked interests", () => {
    const memory = selectFeedPreferenceMemory([entry("more_like_this")], prefs, now, "unrelated current topic")
    expect(memory).toHaveLength(1)
    expect(memory[0]).toMatchObject({ note: "I need adult studies.", abstract: "EEG in children." })
    expect(memory[0].guidance).toContain("not named at onboarding")
    expect(memory[0].preference).toEqual({ facet: "example", effect: "boost", scope: "related_papers", horizon: "current" })
  })
  it("distinguishes freshness/method feedback and does not learn from ordinary dismissal or already read", () => {
    const memory = selectFeedPreferenceMemory([entry("too_old"), entry("wrong_method"), entry("already_know"), entry("dismiss")], prefs, now)
    expect(memory).toHaveLength(2)
    expect(memory.find((m) => m.reason === "too_old")?.guidance).toContain("not negative topic")
    expect(memory.find((m) => m.reason === "wrong_method")?.guidance).toContain("not the topic")
    expect(memory.find((m) => m.reason === "wrong_method")?.preference.facet).toBe("approach")
  })
  it("retrieves abbreviation/abstract matches before equally recent unrelated memories", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ ...entry("more_like_this", `a-${i}`), title: "Unrelated work", abstract: "Different subject", note: "", topics: [] }))
    entries.push({ ...entry("more_like_this", "z-eeg"), title: "Neural signals", abstract: "EEG measured in humans", note: "", topics: [] })
    expect(selectFeedPreferenceMemory(entries, prefs, now, "EEG")[0].paperKey).toBe("z-eeg")
  })
  it("respects disabled learning, reset, future dates, expiration and newest vote", () => {
    const votes = [entry("more_like_this"), { ...entry("not_my_topic"), paperKey: "more_like_this" }]
    expect(selectFeedPreferenceMemory(votes, prefs, now)[0].reason).toBe("not_my_topic")
    expect(selectFeedPreferenceMemory(votes, { ...prefs, learnFromFeedback: false }, now)).toEqual([])
    expect(selectFeedPreferenceMemory(votes, { ...prefs, resetAt: now.toISOString() }, now)).toEqual([])
    expect(selectFeedPreferenceMemory([{ ...entry("too_old"), at: "2027-01-01T00:00:00Z" }, { ...entry("too_old"), at: "2020-01-01T00:00:00Z" }], prefs, now)).toEqual([])
    expect(selectFeedPreferenceMemory([{ ...entry("too_old"), at: "2026-09-05T00:00:00Z" }], prefs, now)).toHaveLength(1)
  })
  it("bounds context while retaining positive and negative examples", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry(i % 2 ? "more_like_this" : "less_like_this", String(i)), abstract: "x".repeat(2000), note: "z".repeat(600) }))
    const memories = selectFeedPreferenceMemory(entries, prefs, now)
    expect(memories.length).toBeLessThanOrEqual(24)
    expect(JSON.stringify(memories).length).toBeLessThanOrEqual(18_000)
    expect(new Set(memories.map((m) => m.reason)).size).toBe(2)
  })
})
