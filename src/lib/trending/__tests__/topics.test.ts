import { describe, it, expect } from "vitest"
import {
  completeWindows,
  rankHeatingTopics,
  selectTopicCandidates,
  MIN_RECENT_COUNT,
  MAX_LEADERBOARD_TOPICS,
  CANDIDATE_POOL,
} from "../topics"

describe("completeWindows", () => {
  it("excludes the in-progress week and returns two 14-day windows", () => {
    // 2026-07-24 is a Friday; its ISO week starts Monday 2026-07-20.
    const { recent, prior } = completeWindows(new Date("2026-07-24T12:00:00Z"))
    expect(recent).toEqual({ fromDate: "2026-07-06", toDate: "2026-07-19" })
    expect(prior).toEqual({ fromDate: "2026-06-22", toDate: "2026-07-05" })
  })

  it("is stable anywhere inside the same in-progress week", () => {
    const a = completeWindows(new Date("2026-07-20T00:00:00Z")) // Monday
    const b = completeWindows(new Date("2026-07-26T23:59:59Z")) // Sunday
    expect(a).toEqual(b)
  })
})

/** One discipline's RECENT-window buckets. Prior counts are looked up, never grouped. */
const d = (discipline: string, recent: Array<[string, number]>) => ({
  discipline,
  recent: recent.map(([k, count]) => ({ key: k, label: `L:${k}`, count })),
})

const priors = (entries: Array<[string, number]>) => new Map(entries)

describe("selectTopicCandidates", () => {
  it("orders by recent volume and caps the pool at CANDIDATE_POOL", () => {
    const recent = Array.from({ length: CANDIDATE_POOL + 8 }, (_, i) => [`t${i}`, 10 + i] as [string, number])
    const out = selectTopicCandidates([d("Neuro", recent)])
    expect(out).toHaveLength(CANDIDATE_POOL)
    expect(out[0]).toMatchObject({ key: `t${CANDIDATE_POOL + 7}`, recentCount: 10 + CANDIDATE_POOL + 7 })
    // The lowest-volume topics are the ones that never get a prior lookup.
    expect(out.map((c) => c.key)).not.toContain("t0")
  })

  it("drops topics under the volume floor before spending a lookup on them", () => {
    const out = selectTopicCandidates([d("Neuro", [["small", MIN_RECENT_COUNT - 1], ["big", MIN_RECENT_COUNT]])])
    expect(out.map((c) => c.key)).toEqual(["big"])
  })

  it("dedupes a topic shared by two disciplines, keeping the higher recent count", () => {
    const out = selectTopicCandidates([d("Neuro", [["shared", 8]]), d("CS", [["shared", 30]])])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("returns [] for no input", () => {
    expect(selectTopicCandidates([])).toEqual([])
  })
})

describe("rankHeatingTopics", () => {
  it("computes growth from the looked-up prior counts and sorts fastest first", () => {
    const out = rankHeatingTopics([d("Neuro", [["a", 20], ["b", 12]])], priors([["a", 10], ["b", 10]]))
    expect(out.map((t) => [t.key, t.growth])).toEqual([
      ["a", 1],
      ["b", 0.2],
    ])
  })

  it("REGRESSION: a topic missing from the prior GROUPED list still gets real growth from its looked-up prior count", () => {
    // The 200-bucket horizon, measured live on Computer Science (2026-07-25):
    // the recent window's 200th bucket held 14 works, the prior window's held
    // 22, so "Remote-Sensing Image Classification" (27 recent) cleared the
    // recent list but fell off the prior one. Joining the two grouped lists
    // recorded priorCount 0 → growth null → rendered "new" → sorted first,
    // and 60 of 200 topics were affected. Its TRUE prior count is 16, i.e.
    // +69% — a real, finite figure, and NOT "new".
    const out = rankHeatingTopics(
      [{ discipline: "Computer Science", recent: [{ key: "T10689", label: "Remote-Sensing Image Classification", count: 27 }] }],
      priors([["T10689", 16]]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].priorCount).toBe(16)
    expect(out[0].growth).not.toBeNull()
    expect(out[0].growth).toBeCloseTo(0.6875)
  })

  it("a GENUINE zero prior still yields growth null (that is what \"new\" now means)", () => {
    const out = rankHeatingTopics([d("Neuro", [["new", 9], ["grown", 20]])], priors([["new", 0], ["grown", 10]]))
    expect(out[0]).toMatchObject({ key: "new", growth: null, priorCount: 0 })
    expect(out[1]).toMatchObject({ key: "grown", growth: 1 })
  })

  it("drops a candidate whose prior count was never measured (unknown is not zero)", () => {
    // Outside the bounded candidate pool, or its lookup request failed: the
    // row is omitted rather than defaulted to 0 and mislabelled "new".
    const out = rankHeatingTopics([d("Neuro", [["measured", 20], ["unmeasured", 30]])], priors([["measured", 10]]))
    expect(out.map((t) => t.key)).toEqual(["measured"])
  })

  it("drops topics under the volume floor", () => {
    const out = rankHeatingTopics(
      [d("Neuro", [["small", MIN_RECENT_COUNT - 1], ["big", MIN_RECENT_COUNT]])],
      priors([["small", 1], ["big", 1]]),
    )
    expect(out.map((t) => t.key)).toEqual(["big"])
  })

  it("merges disciplines into one board and tags each row's discipline", () => {
    const out = rankHeatingTopics([d("Neuro", [["n", 30]]), d("CS", [["c", 12]])], priors([["n", 10], ["c", 10]]))
    expect(out.map((t) => [t.key, t.discipline])).toEqual([
      ["n", "Neuro"],
      ["c", "CS"],
    ])
  })

  it("keeps the higher-count side when one topic appears under two disciplines", () => {
    const out = rankHeatingTopics([d("Neuro", [["shared", 8]]), d("CS", [["shared", 30]])], priors([["shared", 10]]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("keeps the higher-count side regardless of which discipline is listed first", () => {
    const out = rankHeatingTopics([d("CS", [["shared", 30]]), d("Neuro", [["shared", 8]])], priors([["shared", 10]]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("caps the board at MAX_LEADERBOARD_TOPICS and keeps the highest-growth topics", () => {
    const recent = Array.from({ length: 20 }, (_, i) => [`t${i}`, 10 + i] as [string, number])
    const prior = priors(Array.from({ length: 20 }, (_, i) => [`t${i}`, 5] as [string, number]))
    const out = rankHeatingTopics([d("Neuro", recent)], prior)
    expect(out).toHaveLength(MAX_LEADERBOARD_TOPICS)
    // recentCount 10+i over prior=5 for all → growth is monotonic in i, so the
    // surviving set must be the 10 highest-i topics (t10..t19), highest first.
    expect(out.map((t) => t.key)).toEqual(["t19", "t18", "t17", "t16", "t15", "t14", "t13", "t12", "t11", "t10"])
    for (const dropped of ["t0", "t1", "t8", "t9"]) {
      expect(out.map((t) => t.key)).not.toContain(dropped)
    }
  })

  it("returns [] for no input", () => {
    expect(rankHeatingTopics([], new Map())).toEqual([])
  })
})
