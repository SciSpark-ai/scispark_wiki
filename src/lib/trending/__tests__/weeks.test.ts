import { describe, it, expect } from "vitest"
import { isoWeekStart, buildWeekStarts } from "../weeks"

describe("isoWeekStart", () => {
  it("maps a Sunday to the previous Monday (UTC)", () => {
    // 2026-07-12 is a Sunday.
    expect(isoWeekStart(new Date("2026-07-12T00:00:00.000Z"))).toBe("2026-07-06")
  })

  it("maps a Monday to itself", () => {
    expect(isoWeekStart(new Date("2026-07-06T00:00:00.000Z"))).toBe("2026-07-06")
  })
})

describe("buildWeekStarts", () => {
  it("returns `weeks` dates, oldest first, ending on now's ISO week Monday", () => {
    // 2026-07-14 is a Tuesday; its week's Monday is 2026-07-13.
    const result = buildWeekStarts(new Date("2026-07-14T00:00:00.000Z"), 8)
    expect(result.length).toBe(8)
    expect(result[result.length - 1]).toBe("2026-07-13")
    expect(result[0]).toBe("2026-05-25")
    // strictly increasing by 7 days
    for (let i = 1; i < result.length; i++) {
      const prev = new Date(`${result[i - 1]}T00:00:00.000Z`).getTime()
      const cur = new Date(`${result[i]}T00:00:00.000Z`).getTime()
      expect(cur - prev).toBe(7 * 24 * 60 * 60 * 1000)
    }
  })
})
