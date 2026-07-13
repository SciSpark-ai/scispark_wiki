// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest"
import { plainTextOf, rangeToOffsets, offsetsToRange } from "../dom-offsets"

function buildSurface(): HTMLDivElement {
  const root = document.createElement("div")
  root.innerHTML =
    "<p>Hello <strong>world</strong>, this is a test.</p>" + "<p>Second paragraph goes here.</p>"
  document.body.appendChild(root)
  return root
}

describe("plainTextOf", () => {
  it("equals the root's textContent", () => {
    const root = buildSurface()
    expect(plainTextOf(root)).toBe(root.textContent)
    expect(plainTextOf(root)).toContain("Hello world, this is a test.")
    expect(plainTextOf(root)).toContain("Second paragraph goes here.")
  })
})

describe("rangeToOffsets / offsetsToRange round-trip", () => {
  let root: HTMLDivElement

  beforeEach(() => {
    root = buildSurface()
  })

  it("round-trips a selection entirely within one text node", () => {
    const text = plainTextOf(root)
    const start = text.indexOf("Hello")
    const end = start + "Hello".length

    const range = offsetsToRange(root, start, end)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe("Hello")

    const offsets = rangeToOffsets(root, range!)
    expect(offsets).toEqual({ start, end })
  })

  it("round-trips a selection that spans across a nested <strong> element", () => {
    const text = plainTextOf(root)
    // "Hello world, this is a test." -> select "lo world, th" (starts inside
    // the plain "Hello " text node, crosses into <strong>world</strong>, and
    // ends back in the plain text node that follows it).
    const start = text.indexOf("lo world")
    const end = text.indexOf(", this") + ", th".length
    expect(start).toBeGreaterThanOrEqual(0)

    const range = offsetsToRange(root, start, end)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe(text.slice(start, end))

    const offsets = rangeToOffsets(root, range!)
    expect(offsets).toEqual({ start, end })
  })

  it("round-trips a selection that spans across two <p> elements", () => {
    const text = plainTextOf(root)
    const start = text.indexOf("a test.")
    const end = text.indexOf("Second paragraph") + "Second paragraph".length

    const range = offsetsToRange(root, start, end)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe(text.slice(start, end))

    const offsets = rangeToOffsets(root, range!)
    expect(offsets).toEqual({ start, end })
  })

  it("round-trips every contiguous substring boundary in a small sample (nested elements exhaustive check)", () => {
    const small = document.createElement("div")
    small.innerHTML = "<p>ab<strong>cd</strong>ef</p><p>gh</p>"
    document.body.appendChild(small)
    const text = plainTextOf(small)
    expect(text).toBe("abcdefgh")

    for (let start = 0; start < text.length; start += 1) {
      for (let end = start + 1; end <= text.length; end += 1) {
        const range = offsetsToRange(small, start, end)
        expect(range).not.toBeNull()
        expect(range!.toString()).toBe(text.slice(start, end))
        expect(rangeToOffsets(small, range!)).toEqual({ start, end })
      }
    }
  })

  it("returns null from rangeToOffsets for a collapsed range", () => {
    const p = root.querySelector("p")!
    const textNode = p.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 2)
    range.setEnd(textNode, 2)
    expect(range.collapsed).toBe(true)

    expect(rangeToOffsets(root, range)).toBeNull()
  })

  it("returns null from offsetsToRange when start >= end", () => {
    expect(offsetsToRange(root, 5, 5)).toBeNull()
    expect(offsetsToRange(root, 8, 3)).toBeNull()
  })

  it("returns null from offsetsToRange when offsets are out of bounds", () => {
    const text = plainTextOf(root)
    expect(offsetsToRange(root, 0, text.length + 1000)).toBeNull()
  })
})
