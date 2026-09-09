import { describe, it, expect } from "vitest"
import { relativeTime } from "../spend-time"

describe("relativeTime", () => {
  it("renders 'just now' for anything under 45 seconds", () => {
    expect(relativeTime("2026-07-19T00:00:00.000Z", new Date("2026-07-19T00:00:30.000Z"))).toBe("just now")
  })

  it("renders minutes for sub-hour gaps", () => {
    expect(relativeTime("2026-07-19T00:00:00.000Z", new Date("2026-07-19T00:05:00.000Z"))).toBe("5m ago")
  })

  it("renders hours for sub-day gaps", () => {
    expect(relativeTime("2026-07-19T00:00:00.000Z", new Date("2026-07-19T03:00:00.000Z"))).toBe("3h ago")
  })

  it("renders days for sub-month gaps", () => {
    expect(relativeTime("2026-07-10T00:00:00.000Z", new Date("2026-07-19T00:00:00.000Z"))).toBe("9d ago")
  })

  it("renders months for sub-year gaps", () => {
    expect(relativeTime("2026-01-19T00:00:00.000Z", new Date("2026-07-19T00:00:00.000Z"))).toBe("6mo ago")
  })

  it("renders years for year-plus gaps", () => {
    expect(relativeTime("2024-07-19T00:00:00.000Z", new Date("2026-07-19T00:00:00.000Z"))).toBe("2y ago")
  })

  it("clamps a future timestamp to 'just now' instead of a negative duration", () => {
    expect(relativeTime("2026-07-19T00:01:00.000Z", new Date("2026-07-19T00:00:00.000Z"))).toBe("just now")
  })

  it("defaults now to the real clock when omitted", () => {
    // Called with no `now` at all — should not throw and should format
    // something sane for a timestamp a few seconds in the past.
    const ts = new Date(Date.now() - 1000).toISOString()
    expect(relativeTime(ts)).toBe("just now")
  })
})
