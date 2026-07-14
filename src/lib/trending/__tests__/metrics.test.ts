import { describe, it, expect } from "vitest"
import type { PaperRecord } from "../../papers/types"
import { computeFieldMetrics } from "../metrics"

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
})
