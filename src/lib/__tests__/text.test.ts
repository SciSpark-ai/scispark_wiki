import { describe, it, expect } from "vitest"
import { tokenize, truncateAtWhitespace } from "../text"

describe("tokenize", () => {
  it("lower-cases, splits on non-alphanumerics and drops short tokens", () => {
    expect([...tokenize("EEG-based Auditory attention, 2024!")]).toEqual(["based", "auditory", "attention", "2024"])
  })
  it("honors a custom minimum length", () => {
    expect([...tokenize("a bb ccc", 2)]).toEqual(["bb", "ccc"])
  })
})

describe("truncateAtWhitespace", () => {
  it("returns short text unchanged", () => {
    expect(truncateAtWhitespace("short", 10)).toBe("short")
  })
  it("cuts back to the last whitespace before the limit", () => {
    expect(truncateAtWhitespace("alpha beta gamma", 12)).toBe("alpha beta")
  })
  it("hard-cuts when no whitespace lies within 200 chars of the limit", () => {
    expect(truncateAtWhitespace("x".repeat(300), 250)).toBe("x".repeat(250))
  })
})
