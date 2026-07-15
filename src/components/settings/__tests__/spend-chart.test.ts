import { describe, it, expect } from "vitest"
import { spendBarLayout } from "../spend-chart"

describe("spendBarLayout", () => {
  const opts = { width: 280, height: 64 }

  it("returns an empty array for no days", () => {
    expect(spendBarLayout([], opts)).toEqual([])
  })

  it("makes the tallest bar fill the full height and a zero day sit on the baseline", () => {
    const bars = spendBarLayout(
      [
        { date: "2026-07-12", totalUsd: 0 },
        { date: "2026-07-13", totalUsd: 2 },
        { date: "2026-07-14", totalUsd: 1 },
      ],
      opts,
    )
    expect(bars).toHaveLength(3)
    // max ($2) fills height → h == height, y == 0
    expect(bars[1].h).toBeCloseTo(64, 6)
    expect(bars[1].y).toBeCloseTo(0, 6)
    // zero day → zero height, sitting on the baseline (y == height)
    expect(bars[0].h).toBeCloseTo(0, 6)
    expect(bars[0].y).toBeCloseTo(64, 6)
    // half-height day
    expect(bars[2].h).toBeCloseTo(32, 6)
  })

  it("lays bars left-to-right in evenly sized slots with a gap", () => {
    const days = [
      { date: "a", totalUsd: 1 },
      { date: "b", totalUsd: 1 },
    ]
    const bars = spendBarLayout(days, { width: 100, height: 40, gap: 4 })
    const slot = 100 / 2
    expect(bars[0].x).toBe(0)
    expect(bars[1].x).toBe(slot)
    expect(bars[0].w).toBe(slot - 4)
    expect(bars.map((b) => b.date)).toEqual(["a", "b"])
    expect(bars.map((b) => b.totalUsd)).toEqual([1, 1])
  })

  it("produces finite geometry for an all-zero series (no divide-by-zero)", () => {
    const bars = spendBarLayout(
      [
        { date: "x", totalUsd: 0 },
        { date: "y", totalUsd: 0 },
      ],
      opts,
    )
    for (const b of bars) {
      expect(Number.isFinite(b.h)).toBe(true)
      expect(Number.isFinite(b.y)).toBe(true)
      expect(b.h).toBe(0)
    }
  })

  it("never emits a negative width when the gap exceeds the slot", () => {
    const bars = spendBarLayout([{ date: "a", totalUsd: 1 }], { width: 2, height: 10, gap: 8 })
    expect(bars[0].w).toBe(0)
  })
})
