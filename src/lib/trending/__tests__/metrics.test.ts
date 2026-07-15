import { describe, it, expect } from "vitest"
import type { PaperRecord } from "../../papers/types"
import { computeFieldMetrics, type VolumePoint } from "../metrics"

const NOW = new Date("2026-07-14T00:00:00.000Z") // a Tuesday

function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...o }
}

describe("computeFieldMetrics", () => {
  it("counts recent vs prior window and computes pctChange", () => {
    const recent = [
      paper({ title: "r1", date: "2026-07-10", year: 2026 }),
      paper({ title: "r2", date: "2026-07-12", year: 2026 }),
    ]
    // movers includes both recent and a paper from the prior 14-day window
    const movers = [
      ...recent,
      paper({ title: "p1", date: "2026-06-25", year: 2026, citationCount: 10 }),
    ]
    const m = computeFieldMetrics({ recent, movers }, { now: NOW, recentWindowDays: 14 })
    expect(m.paperCountRecent).toBe(2)
    expect(m.paperCountPrior).toBe(1)
    expect(m.pctChange).toBeCloseTo(1.0) // (2-1)/1
  })

  it("pctChange is null when the prior window is empty", () => {
    const recent = [paper({ title: "r1", date: "2026-07-10", year: 2026 })]
    const m = computeFieldMetrics({ recent, movers: recent }, { now: NOW })
    expect(m.paperCountPrior).toBe(0)
    expect(m.pctChange).toBeNull()
  })

  it("buckets weekly volume by ISO week start (Monday UTC)", () => {
    const movers = [
      paper({ title: "a", date: "2026-07-06", year: 2026 }), // Mon week of 07-06
      paper({ title: "b", date: "2026-07-08", year: 2026 }), // same week
      paper({ title: "c", date: "2026-06-29", year: 2026 }), // week of 06-29
    ]
    const m = computeFieldMetrics({ recent: [], movers }, { now: NOW, weeks: 8 })
    const wk = Object.fromEntries(m.weeklyVolume.map((v) => [v.weekStart, v.count]))
    expect(wk["2026-07-06"]).toBe(2)
    expect(wk["2026-06-29"]).toBe(1)
    expect(m.weeklyVolume.length).toBe(8) // fixed-length series, zero-filled
  })

  it("top movers are citation-sorted with numeric counts only; top venues by frequency", () => {
    const movers = [
      paper({ title: "hi", citationCount: 50, venue: "ACL" }),
      paper({ title: "mid", citationCount: 5, venue: "ACL" }),
      paper({ title: "none", venue: "EMNLP" }), // no citationCount → excluded from topMovers
    ]
    const m = computeFieldMetrics({ recent: [], movers }, { now: NOW })
    expect(m.topMovers.map((t) => t.paper.title)).toEqual(["hi", "mid"])
    expect(m.topVenues[0]).toEqual({ venue: "ACL", count: 2 })
  })

  it("handles empty input without throwing", () => {
    const m = computeFieldMetrics({ recent: [], movers: [] }, { now: NOW })
    expect(m).toMatchObject({ paperCountRecent: 0, paperCountPrior: 0, pctChange: null, topMovers: [], topVenues: [] })
    expect(m.weeklyVolume.every((v) => v.count === 0)).toBe(true)
  })

  it("trims venue names before aggregating so trailing-space variants merge", () => {
    const movers = [
      paper({ title: "a", venue: "ACL" }),
      paper({ title: "b", venue: "ACL " }), // trailing space — same venue
    ]
    const m = computeFieldMetrics({ recent: [], movers }, { now: NOW })
    expect(m.topVenues).toEqual([{ venue: "ACL", count: 2 }])
  })

  it("prior window is [priorCutoff, recentCutoff): boundary papers land on exactly one side, never both", () => {
    // windowDays=14, now=2026-07-14T00:00:00Z => recentCutoff=2026-06-30T00:00:00.000Z,
    // priorCutoff=2026-06-16T00:00:00.000Z
    const onRecentCutoff = paper({ title: "on-recent-cutoff", date: "2026-06-30T00:00:00.000Z", year: 2026 })
    const onPriorCutoff = paper({ title: "on-prior-cutoff", date: "2026-06-16T00:00:00.000Z", year: 2026 })
    const movers = [onRecentCutoff, onPriorCutoff]
    const m = computeFieldMetrics({ recent: [], movers }, { now: NOW, recentWindowDays: 14 })
    // Only the paper dated exactly priorCutoff counts (t >= priorCutoff && t < recentCutoff);
    // the paper dated exactly recentCutoff does not (excluded by t < recentCutoff).
    expect(m.paperCountPrior).toBe(1)
  })

  it("a future-dated paper does not crash weeklyVolume and contributes to no bucket", () => {
    const future = paper({ title: "future", date: "2026-07-20", year: 2026 }) // a week after NOW
    const m = computeFieldMetrics({ recent: [], movers: [future] }, { now: NOW, weeks: 8 })
    expect(m.weeklyVolume.length).toBe(8)
    expect(m.weeklyVolume.every((v) => v.count === 0)).toBe(true)
    expect(m.paperCountPrior).toBe(0)
  })
})

describe("computeFieldMetrics — realWeeklyVolume", () => {
  it("uses realWeeklyVolume verbatim and computes week-aligned recent/prior/pctChange", () => {
    const realWeeklyVolume: VolumePoint[] = [
      { weekStart: "2026-05-18", count: 3 },
      { weekStart: "2026-05-25", count: 4 },
      { weekStart: "2026-06-01", count: 5 },
      { weekStart: "2026-06-08", count: 6 },
      { weekStart: "2026-06-15", count: 7 },
      { weekStart: "2026-06-22", count: 8 },
      { weekStart: "2026-06-29", count: 9 },
      { weekStart: "2026-07-06", count: 10 },
    ]
    const m = computeFieldMetrics({ recent: [], movers: [] }, { now: NOW, realWeeklyVolume })
    expect(m.weeklyVolume).toEqual(realWeeklyVolume) // verbatim, not re-bucketed
    expect(m.paperCountRecent).toBe(10 + 9) // last 2 buckets: 07-06, 06-29
    expect(m.paperCountPrior).toBe(8 + 7) // 2 buckets before those: 06-22, 06-15
    expect(m.pctChange).toBeCloseTo((19 - 15) / 15)
  })

  it("pctChange is null when the prior 2 buckets sum to zero", () => {
    const realWeeklyVolume: VolumePoint[] = [
      { weekStart: "2026-06-22", count: 0 },
      { weekStart: "2026-06-29", count: 0 },
      { weekStart: "2026-07-06", count: 5 },
    ]
    const m = computeFieldMetrics({ recent: [], movers: [] }, { now: NOW, realWeeklyVolume })
    expect(m.paperCountRecent).toBe(0 + 5)
    expect(m.paperCountPrior).toBe(0)
    expect(m.pctChange).toBeNull()
  })

  it("handles a series with fewer than 4 buckets, treating missing older weeks as 0", () => {
    const realWeeklyVolume: VolumePoint[] = [
      { weekStart: "2026-06-29", count: 3 },
      { weekStart: "2026-07-06", count: 4 },
    ]
    const m = computeFieldMetrics({ recent: [], movers: [] }, { now: NOW, realWeeklyVolume })
    expect(m.weeklyVolume).toEqual(realWeeklyVolume)
    expect(m.paperCountRecent).toBe(3 + 4)
    expect(m.paperCountPrior).toBe(0) // no buckets before the only 2 present
    expect(m.pctChange).toBeNull()
  })

  it("topMovers/topVenues still derive from the sample even when realWeeklyVolume is present", () => {
    const movers = [paper({ title: "hi", citationCount: 50, venue: "ACL" })]
    const realWeeklyVolume: VolumePoint[] = [{ weekStart: "2026-07-06", count: 1 }]
    const m = computeFieldMetrics({ recent: [], movers }, { now: NOW, realWeeklyVolume })
    expect(m.topMovers.map((t) => t.paper.title)).toEqual(["hi"])
    expect(m.topVenues[0]).toEqual({ venue: "ACL", count: 1 })
  })
})
