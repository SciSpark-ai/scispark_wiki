import { describe, it, expect } from "vitest"
import { barLayout } from "../chart-geometry"

const POINTS = [
  { weekStart: "2026-06-01", count: 0 },
  { weekStart: "2026-06-08", count: 4 },
  { weekStart: "2026-06-15", count: 2 },
]

describe("barLayout", () => {
  it("maps counts to bar rects within the given box; tallest bar reaches full height", () => {
    const bars = barLayout(POINTS, { width: 120, height: 40 })
    expect(bars).toHaveLength(3)
    const tallest = bars[1] // count 4 is the max
    expect(tallest.h).toBeCloseTo(40)
    expect(tallest.y).toBeCloseTo(0)
    const zero = bars[0] // count 0 → zero height, sits at the baseline
    expect(zero.h).toBe(0)
    expect(zero.y).toBeCloseTo(40)
    // bars are left-to-right, non-overlapping, within width
    expect(bars[0].x).toBeLessThan(bars[1].x)
    expect(bars[2].x + bars[2].w).toBeLessThanOrEqual(120)
  })

  it("handles all-zero counts without NaN (flat baseline)", () => {
    const bars = barLayout([{ weekStart: "a", count: 0 }, { weekStart: "b", count: 0 }], { width: 50, height: 20 })
    expect(bars.every((b) => b.h === 0 && Number.isFinite(b.y))).toBe(true)
  })

  it("returns [] for empty input", () => {
    expect(barLayout([], { width: 10, height: 10 })).toEqual([])
  })
})
