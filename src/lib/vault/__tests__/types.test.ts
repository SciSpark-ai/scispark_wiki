import { describe, it, expect } from "vitest"
import { PAGE_TYPES } from "../types"

describe("PAGE_TYPES", () => {
  it("includes 'query' — reinstated saved-answer page type (SP5 task 1)", () => {
    expect(PAGE_TYPES).toContain("query")
  })
})
