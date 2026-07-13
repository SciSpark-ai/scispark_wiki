import { describe, it, expect } from "vitest"
import { joinPageText } from "../pdf-text"

describe("joinPageText", () => {
  it("returns empty text and offsets for an empty items array", () => {
    expect(joinPageText([])).toEqual({ text: "", itemOffsets: [] })
  })

  it("joins a single item with no separator and offset 0", () => {
    expect(joinPageText([{ str: "Abstract" }])).toEqual({
      text: "Abstract",
      itemOffsets: [0],
    })
  })

  it("joins multiple items with a single space between them", () => {
    const result = joinPageText([{ str: "The" }, { str: "quick" }, { str: "fox" }])
    expect(result.text).toBe("The quick fox")
    expect(result.itemOffsets).toEqual([0, 4, 10])
  })

  it("aligns itemOffsets[i] with the actual start of items[i] in the joined text", () => {
    const items = [{ str: "one" }, { str: "two" }, { str: "three" }, { str: "four" }]
    const { text, itemOffsets } = joinPageText(items)
    itemOffsets.forEach((offset, i) => {
      expect(text.slice(offset, offset + items[i].str.length)).toBe(items[i].str)
    })
  })

  it("handles empty-string items as zero-length spans that still consume a separator", () => {
    const result = joinPageText([{ str: "a" }, { str: "" }, { str: "b" }])
    // "a" + " " + "" + " " + "b" -> "a  b"
    expect(result.text).toBe("a  b")
    expect(result.itemOffsets).toEqual([0, 2, 3])
  })

  it("is deterministic for the same input", () => {
    const items = [{ str: "x" }, { str: "y" }]
    expect(joinPageText(items)).toEqual(joinPageText(items))
  })
})
