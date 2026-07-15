import { describe, it, expect } from "vitest"
import { fetchWeeklyVolume, type CountFn, type GroupFn } from "../weekly-volume"

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

describe("fetchWeeklyVolume with groupFn (group_by fast path)", () => {
  const weekStarts = ["2026-06-29", "2026-07-06"] // two ISO weeks: Jun29-Jul5, Jul6-Jul12

  it("happy path: issues ONE grouped request spanning the window and sums daily keys into the correct ISO-week buckets, zero-filled, ignoring out-of-window keys", async () => {
    let calls = 0
    let seenRange: { fromDate: string; toDate: string } | undefined
    const groupFn: GroupFn = async (q) => {
      calls++
      seenRange = { fromDate: q.fromDate, toDate: q.toDate }
      return [
        { key: "2026-06-29", count: 3 }, // week 1 (Mon)
        { key: "2026-07-01T00:00:00.000Z", count: 2 }, // week 1 (Wed, tolerate time suffix)
        { key: "2026-07-06", count: 4 }, // week 2 (Mon)
        { key: "2026-07-10", count: 1 }, // week 2 (Fri)
        { key: "2026-07-13", count: 100 }, // outside the requested window — ignored
      ]
    }
    const countFn: CountFn = async () => {
      throw new Error("countFn must not be called when the grouped path succeeds")
    }

    const vol = await fetchWeeklyVolume(countFn, "nlp", weekStarts, groupFn)

    expect(calls).toBe(1)
    expect(seenRange).toEqual({ fromDate: "2026-06-29", toDate: "2026-07-12" }) // spans weekStarts[0]..weekEnd(last)
    expect(vol).toEqual([
      { weekStart: "2026-06-29", count: 5 },
      { weekStart: "2026-07-06", count: 5 },
    ])
  })

  it("zero-fills a week with no matching daily keys", async () => {
    const groupFn: GroupFn = async () => [{ key: "2026-06-29", count: 7 }]
    const countFn: CountFn = async () => {
      throw new Error("countFn must not be called")
    }

    const vol = await fetchWeeklyVolume(countFn, "nlp", weekStarts, groupFn)

    expect(vol).toEqual([
      { weekStart: "2026-06-29", count: 7 },
      { weekStart: "2026-07-06", count: 0 },
    ])
  })

  it("falls back to countFn when groupFn throws", async () => {
    const groupFn: GroupFn = async () => {
      throw new Error("openalex group_by down")
    }
    let countCalls = 0
    const countFn: CountFn = async (q) => {
      countCalls++
      return q.fromDate === "2026-07-06" ? 5 : 2
    }

    const vol = await fetchWeeklyVolume(countFn, "nlp", weekStarts, groupFn)

    expect(countCalls).toBe(2)
    expect(vol).toEqual([
      { weekStart: "2026-06-29", count: 2 },
      { weekStart: "2026-07-06", count: 5 },
    ])
  })

  it("falls back to countFn when groupFn returns an empty array", async () => {
    const groupFn: GroupFn = async () => []
    let countCalls = 0
    const countFn: CountFn = async () => {
      countCalls++
      return 9
    }

    const vol = await fetchWeeklyVolume(countFn, "nlp", weekStarts, groupFn)

    expect(countCalls).toBe(2)
    expect(vol).toEqual([
      { weekStart: "2026-06-29", count: 9 },
      { weekStart: "2026-07-06", count: 9 },
    ])
  })

  it("with no groupFn argument, behaves exactly like the existing countFn-only path", async () => {
    let countCalls = 0
    const countFn: CountFn = async () => {
      countCalls++
      return 4
    }

    const vol = await fetchWeeklyVolume(countFn, "nlp", weekStarts)

    expect(countCalls).toBe(2)
    expect(vol).toEqual([
      { weekStart: "2026-06-29", count: 4 },
      { weekStart: "2026-07-06", count: 4 },
    ])
  })
})
