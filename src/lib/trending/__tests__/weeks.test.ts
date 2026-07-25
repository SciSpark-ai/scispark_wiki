import { describe, it, expect } from "vitest"
import { isoWeekStart } from "../weeks"

describe("isoWeekStart", () => {
  it("maps a Sunday to the previous Monday (UTC)", () => {
    // 2026-07-12 is a Sunday.
    expect(isoWeekStart(new Date("2026-07-12T00:00:00.000Z"))).toBe("2026-07-06")
  })

  it("maps a Monday to itself", () => {
    expect(isoWeekStart(new Date("2026-07-06T00:00:00.000Z"))).toBe("2026-07-06")
  })
})
