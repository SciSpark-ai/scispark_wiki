import { describe, it, expect } from "vitest"
import { fetchWeeklyVolume, type CountFn } from "../weekly-volume"

describe("fetchWeeklyVolume", () => {
  it("issues one count per week, aligned to weekStarts, returns VolumePoint[]", async () => {
    const seen: Array<{ fromDate: string; toDate: string }> = []
    const countFn: CountFn = async (q) => {
      seen.push({ fromDate: q.fromDate, toDate: q.toDate })
      return q.fromDate === "2026-07-06" ? 5 : 2
    }
    const vol = await fetchWeeklyVolume(countFn, "nlp", ["2026-06-29", "2026-07-06"])
    expect(vol).toEqual([
      { weekStart: "2026-06-29", count: 2 },
      { weekStart: "2026-07-06", count: 5 },
    ])
    expect(seen[1]).toEqual({ fromDate: "2026-07-06", toDate: "2026-07-12" }) // Mon..Sun inclusive
  })

  it("returns null if any week's count fails (fallback signal)", async () => {
    const countFn: CountFn = async (q) => {
      if (q.fromDate === "2026-07-06") throw new Error("429")
      return 1
    }
    expect(await fetchWeeklyVolume(countFn, "nlp", ["2026-06-29", "2026-07-06"])).toBeNull()
  })

  it("caps concurrency (peak <= 4) but issues every query", async () => {
    const weekStarts = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 5 + i * 7))
      return d.toISOString().slice(0, 10)
    })
    let active = 0
    let peak = 0
    let issued = 0
    const countFn: CountFn = async () => {
      issued++
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return 1
    }
    const vol = await fetchWeeklyVolume(countFn, "nlp", weekStarts)
    expect(issued).toBe(weekStarts.length)
    expect(peak).toBeLessThanOrEqual(4)
    expect(vol?.length).toBe(weekStarts.length)
  })

  it("preserves output order aligned to weekStarts even when count queries complete out of order", async () => {
    // Use >= 4 weekStarts to cross the concurrency cap (MAX_CONCURRENCY = 4)
    const weekStarts = ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"]

    // Each week resolves with a delay inversely proportional to its index in the array.
    // First weekStart (index 0) gets longest delay, last gets shortest.
    // This ensures out-of-order completion (later weeks resolve first),
    // testing that the function re-associates results back to the correct weekStarts by index.
    const countFn: CountFn = async (q) => {
      const index = weekStarts.indexOf(q.fromDate)
      if (index === -1) throw new Error(`Unexpected weekStart: ${q.fromDate}`)

      // Delay inversely proportional to index (first week = longest delay)
      const delayMs = (weekStarts.length - index) * 15
      await new Promise((r) => setTimeout(r, delayMs))

      // Return a count unique to this week (100 + index), so we can verify correct re-association
      return 100 + index
    }

    const vol = await fetchWeeklyVolume(countFn, "test-query", weekStarts)

    // Assert order is preserved: output order must match input weekStarts order
    expect(vol).not.toBeNull()
    expect(vol!.map((v) => v.weekStart)).toEqual(weekStarts)

    // Assert each count is correctly associated with its weekStart by index, not completion order
    weekStarts.forEach((weekStart, i) => {
      const point = vol!.find((v) => v.weekStart === weekStart)
      expect(point?.count).toBe(100 + i)
    })
  })
})
