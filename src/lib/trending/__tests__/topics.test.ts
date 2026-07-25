import { describe, it, expect } from "vitest"
import { completeWindows, rankHeatingTopics, MIN_RECENT_COUNT, MAX_LEADERBOARD_TOPICS } from "../topics"

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

describe("rankHeatingTopics", () => {
  const d = (discipline: string, recent: Array<[string, number]>, prior: Array<[string, number]>) => ({
    discipline,
    recent: recent.map(([k, count]) => ({ key: k, label: `L:${k}`, count })),
    prior: prior.map(([k, count]) => ({ key: k, label: `L:${k}`, count })),
  })

  it("computes growth and sorts fastest first", () => {
    const out = rankHeatingTopics([d("Neuro", [["a", 20], ["b", 12]], [["a", 10], ["b", 10]])])
    expect(out.map((t) => [t.key, t.growth])).toEqual([
      ["a", 1],
      ["b", 0.2],
    ])
  })

  it("drops topics under the volume floor", () => {
    const out = rankHeatingTopics([d("Neuro", [["small", MIN_RECENT_COUNT - 1], ["big", MIN_RECENT_COUNT]], [["small", 1], ["big", 1]])])
    expect(out.map((t) => t.key)).toEqual(["big"])
  })

  it("reports growth null for a topic with no prior activity and ranks it first", () => {
    const out = rankHeatingTopics([d("Neuro", [["new", 9], ["grown", 20]], [["grown", 10]])])
    expect(out[0]).toMatchObject({ key: "new", growth: null, priorCount: 0 })
    expect(out[1]).toMatchObject({ key: "grown", growth: 1 })
  })

  it("merges disciplines into one board and tags each row's discipline", () => {
    const out = rankHeatingTopics([
      d("Neuro", [["n", 30]], [["n", 10]]),
      d("CS", [["c", 12]], [["c", 10]]),
    ])
    expect(out.map((t) => [t.key, t.discipline])).toEqual([
      ["n", "Neuro"],
      ["c", "CS"],
    ])
  })

  it("keeps the higher-count side when one topic appears under two disciplines", () => {
    const out = rankHeatingTopics([
      d("Neuro", [["shared", 8]], [["shared", 4]]),
      d("CS", [["shared", 30]], [["shared", 10]]),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("keeps the higher-count side regardless of which discipline is listed first", () => {
    const out = rankHeatingTopics([
      d("CS", [["shared", 30]], [["shared", 10]]),
      d("Neuro", [["shared", 8]], [["shared", 4]]),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("caps the board at MAX_LEADERBOARD_TOPICS and keeps the highest-growth topics", () => {
    const recent = Array.from({ length: 20 }, (_, i) => [`t${i}`, 10 + i] as [string, number])
    const prior = Array.from({ length: 20 }, (_, i) => [`t${i}`, 5] as [string, number])
    const out = rankHeatingTopics([d("Neuro", recent, prior)])
    expect(out).toHaveLength(MAX_LEADERBOARD_TOPICS)
    // recentCount 10+i over prior=5 for all → growth is monotonic in i, so the
    // surviving set must be the 10 highest-i topics (t10..t19), highest first.
    expect(out.map((t) => t.key)).toEqual(["t19", "t18", "t17", "t16", "t15", "t14", "t13", "t12", "t11", "t10"])
    for (const dropped of ["t0", "t1", "t8", "t9"]) {
      expect(out.map((t) => t.key)).not.toContain(dropped)
    }
  })

  it("returns [] for no input", () => {
    expect(rankHeatingTopics([])).toEqual([])
  })
})
