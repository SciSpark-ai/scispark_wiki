import { describe, it, expect } from "vitest"
import { CONTEXT_LEN, createAnchor, resolveAnchor } from "../anchor"

describe("createAnchor", () => {
  it("slices exact/prefix/suffix and carries start/end hints", () => {
    const text = "The quick brown fox jumps over the lazy dog."
    const start = text.indexOf("brown fox")
    const end = start + "brown fox".length

    const anchor = createAnchor(text, start, end)

    expect(anchor.exact).toBe("brown fox")
    expect(anchor.prefix).toBe(text.slice(Math.max(0, start - CONTEXT_LEN), start))
    expect(anchor.suffix).toBe(text.slice(end, Math.min(text.length, end + CONTEXT_LEN)))
    expect(anchor.start).toBe(start)
    expect(anchor.end).toBe(end)
  })

  it("clamps prefix/suffix at the string bounds (empty at start/end)", () => {
    const text = "Hello world"
    const atStart = createAnchor(text, 0, 5) // "Hello"
    expect(atStart.prefix).toBe("")
    expect(atStart.suffix).toBe(" world")

    const atEnd = createAnchor(text, 6, 11) // "world"
    expect(atEnd.prefix).toBe("Hello ")
    expect(atEnd.suffix).toBe("")
  })

  it("respects a custom contextLen", () => {
    const text = "0123456789ABCDEFGHIJ target KLMNOPQRSTUVWXYZ"
    const start = text.indexOf("target")
    const end = start + "target".length
    const anchor = createAnchor(text, start, end, 5)
    expect(anchor.prefix).toBe(text.slice(start - 5, start))
    expect(anchor.suffix).toBe(text.slice(end, end + 5))
  })

  it("throws when start >= end", () => {
    const text = "some text"
    expect(() => createAnchor(text, 4, 4)).toThrow()
    expect(() => createAnchor(text, 5, 2)).toThrow()
  })

  it("throws on an out-of-range span", () => {
    const text = "short"
    expect(() => createAnchor(text, -1, 3)).toThrow()
    expect(() => createAnchor(text, 0, 999)).toThrow()
  })
})

describe("resolveAnchor", () => {
  it("fast path: unchanged text resolves to the exact original offsets", () => {
    const text = "The quick brown fox jumps over the lazy dog."
    const start = text.indexOf("brown fox")
    const end = start + "brown fox".length
    const anchor = createAnchor(text, start, end)

    expect(resolveAnchor(text, anchor)).toEqual({ start, end })
  })

  it("context search: 200 chars inserted before the quote resolves to shifted offsets", () => {
    const original =
      "Some intro text. " + "A".repeat(50) + " The quick brown fox jumps over the lazy dog. " + "B".repeat(50)
    const start = original.indexOf("quick brown fox")
    const end = start + "quick brown fox".length
    const anchor = createAnchor(original, start, end)

    const inserted = "X".repeat(200) + original
    const resolved = resolveAnchor(inserted, anchor)

    expect(resolved).toEqual({ start: start + 200, end: end + 200 })
    expect(inserted.slice(resolved!.start, resolved!.end)).toBe("quick brown fox")
  })

  it("duplicated quote: context disambiguates the correct occurrence", () => {
    const text =
      "In the first trial, the result was significant for group A. " +
      "In the second trial, the result was significant for group B."
    const exact = "the result was significant"
    const firstIdx = text.indexOf(exact)
    const secondIdx = text.indexOf(exact, firstIdx + 1)
    expect(secondIdx).toBeGreaterThan(firstIdx)

    const anchor = createAnchor(text, secondIdx, secondIdx + exact.length)

    // Shift the whole text so raw offsets no longer line up (bypassing the
    // fast path) while both occurrences of `exact` remain present.
    const shifted = "Preface. " + text
    const resolved = resolveAnchor(shifted, anchor)

    const expectedIdx = shifted.indexOf(exact, shifted.indexOf(exact) + 1)
    expect(resolved).toEqual({ start: expectedIdx, end: expectedIdx + exact.length })
    // Sanity: it did NOT pick the first (wrong) occurrence.
    const wrongIdx = shifted.indexOf(exact)
    expect(resolved!.start).not.toBe(wrongIdx)
  })

  it("orphaned: quote deleted from the text resolves to null", () => {
    const text = "The quick brown fox jumps over the lazy dog."
    const start = text.indexOf("brown fox")
    const end = start + "brown fox".length
    const anchor = createAnchor(text, start, end)

    const modified = text.replace("brown fox", "")
    expect(resolveAnchor(modified, anchor)).toBeNull()
  })

  it("resolves a quote at the very start of the text (empty prefix)", () => {
    const text = "Hello world, this is a test."
    const anchor = createAnchor(text, 0, 5) // "Hello"
    expect(anchor.prefix).toBe("")

    expect(resolveAnchor(text, anchor)).toEqual({ start: 0, end: 5 })

    // Force tier 2 by shifting, confirm it still resolves via suffix context alone.
    const shifted = text + " Hello again, unrelated."
    const resolved = resolveAnchor(shifted, anchor)
    expect(resolved).toEqual({ start: 0, end: 5 })
  })

  it("resolves a quote at the very end of the text (empty suffix)", () => {
    const text = "This is a test of the end"
    const end = text.length
    const start = end - "end".length
    const anchor = createAnchor(text, start, end) // "end"
    expect(anchor.suffix).toBe("")

    expect(resolveAnchor(text, anchor)).toEqual({ start, end })
  })

  it("resolves an exact quote containing regex metacharacters literally", () => {
    const text = "The regex .*[](){} matches everything, special characters and all."
    const exact = ".*[](){}"
    const start = text.indexOf(exact)
    const end = start + exact.length
    const anchor = createAnchor(text, start, end)

    const shifted = "Preamble text here. " + text
    const resolved = resolveAnchor(shifted, anchor)
    const expectedStart = shifted.indexOf(exact)

    expect(resolved).toEqual({ start: expectedStart, end: expectedStart + exact.length })
  })

  it("does not crash on an exact quote that would be an invalid RegExp", () => {
    // An unterminated character class ("[unterminated") throws if ever
    // compiled with `new RegExp(...)`; resolveAnchor must never do that.
    const text = "Before text. [unterminated bracket example. After text."
    const exact = "[unterminated bracket"
    const start = text.indexOf(exact)
    const end = start + exact.length
    const anchor = createAnchor(text, start, end)

    expect(() => new RegExp(exact)).toThrow()

    const shifted = "Extra padding. " + text
    const resolved = resolveAnchor(shifted, anchor)
    const expectedStart = shifted.indexOf(exact)

    expect(resolved).toEqual({ start: expectedStart, end: expectedStart + exact.length })
  })

  it("tie between two identical-context occurrences: closest to start wins", () => {
    const chunk = "abcdefghijklmnopqrstuvwxyz012345" // 33 chars > CONTEXT_LEN
    expect(chunk.length).toBeGreaterThanOrEqual(CONTEXT_LEN)
    const text = `${chunk}TARGET${chunk}TARGET${chunk}`

    const firstIdx = text.indexOf("TARGET")
    const anchor = createAnchor(text, firstIdx, firstIdx + "TARGET".length)

    // Shift by a couple of characters so the fast path misses but the
    // anchor's start hint remains much closer to the first occurrence.
    const shifted = "XX" + text
    const resolved = resolveAnchor(shifted, anchor)

    const shiftedFirstIdx = shifted.indexOf("TARGET")
    expect(resolved).toEqual({ start: shiftedFirstIdx, end: shiftedFirstIdx + "TARGET".length })
  })

  it("returns null when exact occurs nowhere at all (never crashes)", () => {
    const text = "abc"
    const anchor = createAnchor("xyz-needle-xyz", 4, 10) // "needle"
    expect(resolveAnchor(text, anchor)).toBeNull()
  })

  it("orphans a malformed empty-exact anchor instead of returning a zero-width span", () => {
    // createAnchor can never produce this (it throws on start>=end), but a
    // corrupted stored anchor could; resolveAnchor must reject it.
    const anchor = { exact: "", prefix: "abc", suffix: "def", start: 5, end: 5 }
    expect(resolveAnchor("abcdef ghij", anchor)).toBeNull()
  })
})
