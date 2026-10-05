import { describe, it, expect } from "vitest"
import { parseJsonLoosely } from "../json"

describe("parseJsonLoosely", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoosely('{"a":1}')).toEqual({ a: 1 })
  })
  it("parses a fenced block and JSON wrapped in prose", () => {
    expect(parseJsonLoosely('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonLoosely('Here you go: [1,2] thanks')).toEqual([1, 2])
  })
  it("returns undefined when nothing parses", () => {
    expect(parseJsonLoosely("not json")).toBeUndefined()
  })
})
