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
})
