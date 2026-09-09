import { describe, it, expect } from "vitest"
import { summarizeUsage } from "../usage-summary"
import type { UsageRecord } from "../metering"

function rec(overrides: Partial<UsageRecord> & { ts: string }): UsageRecord {
  return {
    skill: "digest",
    runId: "run-1",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    usage: { inputTokens: 100, outputTokens: 100 },
    costUsd: 1,
    ...overrides,
  }
}

describe("summarizeUsage", () => {
  const now = new Date("2026-07-12T10:00:00.000Z")

  it("returns zeroed output for empty input", () => {
    const summary = summarizeUsage([], now)
    expect(summary.today).toEqual({ totalUsd: 0, bySkill: [] })
    expect(summary.unpricedCount).toBe(0)
    expect(summary.days).toHaveLength(7)
    expect(summary.days.every((d) => d.totalUsd === 0)).toBe(true)
    expect(summary.days[summary.days.length - 1].date).toBe("2026-07-12")
    expect(summary.days[0].date).toBe("2026-07-06")
  })

  it("buckets records across 3 days into a fixed-length zero-filled series ending on now's UTC date", () => {
    const records = [
      rec({ ts: "2026-07-10T01:00:00.000Z", costUsd: 1 }),
      rec({ ts: "2026-07-11T23:59:59.000Z", costUsd: 2 }),
      rec({ ts: "2026-07-12T00:00:01.000Z", costUsd: 3 }),
    ]
    const summary = summarizeUsage(records, now)
    expect(summary.days).toHaveLength(7)
    const byDate = Object.fromEntries(summary.days.map((d) => [d.date, d.totalUsd]))
    expect(byDate["2026-07-10"]).toBe(1)
    expect(byDate["2026-07-11"]).toBe(2)
    expect(byDate["2026-07-12"]).toBe(3)
    expect(byDate["2026-07-06"]).toBe(0)
    // oldest -> newest ordering
    expect(summary.days.map((d) => d.date)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ])
  })

  it("sums today's total and per-skill breakdown, sorted desc", () => {
    const records = [
      rec({ ts: "2026-07-12T01:00:00.000Z", skill: "digest", costUsd: 1 }),
      rec({ ts: "2026-07-12T02:00:00.000Z", skill: "digest", costUsd: 2 }),
      rec({ ts: "2026-07-12T03:00:00.000Z", skill: "feed", costUsd: 5 }),
      rec({ ts: "2026-07-12T04:00:00.000Z", skill: "ingest", costUsd: 0.5 }),
      // a different day's record must not leak into today's totals
      rec({ ts: "2026-07-11T04:00:00.000Z", skill: "feed", costUsd: 100 }),
    ]
    const summary = summarizeUsage(records, now)
    expect(summary.today.totalUsd).toBeCloseTo(8.5, 6)
    expect(summary.today.bySkill).toEqual([
      { skill: "feed", totalUsd: 5 },
      { skill: "digest", totalUsd: 3 },
      { skill: "ingest", totalUsd: 0.5 },
    ])
  })

  it("keeps affected totals unknown when any billed call is unpriced", () => {
    const records = [
      rec({ ts: "2026-07-12T01:00:00.000Z", skill: "digest", costUsd: null }),
      rec({ ts: "2026-07-12T02:00:00.000Z", skill: "digest", costUsd: 4 }),
    ]
    const summary = summarizeUsage(records, now)
    expect(summary.today.totalUsd).toBeNull()
    expect(summary.today.bySkill).toEqual([{ skill: "digest", totalUsd: null }])
    expect(summary.unpricedCount).toBe(1)
    const byDate = Object.fromEntries(summary.days.map((d) => [d.date, d.totalUsd]))
    expect(byDate["2026-07-12"]).toBeNull()
  })

  it("excludes records outside the days window from the daily series but still tallies their unpriced cost", () => {
    // unpricedCount is scoped to ALL records passed in, not just those inside
    // the `days` window: it's a data-quality signal ("how much of my ledger
    // has no cost"), independent of how many days of chart we're rendering.
    const records = [
      rec({ ts: "2026-06-01T00:00:00.000Z", costUsd: null }), // outside 7-day window
      rec({ ts: "2026-07-12T00:00:00.000Z", costUsd: 1 }),
    ]
    const summary = summarizeUsage(records, now)
    const byDate = Object.fromEntries(summary.days.map((d) => [d.date, d.totalUsd]))
    expect(byDate["2026-06-01"]).toBeUndefined()
    expect(summary.days.reduce((sum, d) => sum + (d.totalUsd ?? 0), 0)).toBe(1)
    expect(summary.unpricedCount).toBe(1)
  })

  it("respects opts.days for the series length", () => {
    const summary = summarizeUsage([], now, { days: 3 })
    expect(summary.days).toHaveLength(3)
    expect(summary.days.map((d) => d.date)).toEqual(["2026-07-10", "2026-07-11", "2026-07-12"])
  })

  it("is pure and deterministic: same inputs produce identical output", () => {
    const records = [rec({ ts: "2026-07-12T01:00:00.000Z", costUsd: 2 })]
    const a = summarizeUsage(records, now)
    const b = summarizeUsage(records, now)
    expect(a).toEqual(b)
  })
})
