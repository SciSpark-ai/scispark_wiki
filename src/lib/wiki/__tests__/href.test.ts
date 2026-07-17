import { describe, it, expect } from "vitest"
import { wikiHref, resolveWikiRouteId } from "../href"

describe("wikiHref (C5)", () => {
  it("emits canonical single-wiki routes from bundle ids", () => {
    expect(wikiHref("wiki/methods/mtrf-toolbox")).toBe("/wiki/methods/mtrf-toolbox")
    expect(wikiHref("wiki/methods/mtrf-toolbox.md")).toBe("/wiki/methods/mtrf-toolbox")
    expect(wikiHref("methods/mtrf-toolbox")).toBe("/wiki/methods/mtrf-toolbox")
  })
})

describe("resolveWikiRouteId (C5)", () => {
  it("maps canonical URLs to bundle ids", () => {
    expect(resolveWikiRouteId("methods/mtrf-toolbox")).toBe("wiki/methods/mtrf-toolbox")
  })
  it("accepts legacy doubled URLs", () => {
    expect(resolveWikiRouteId("wiki/methods/mtrf-toolbox")).toBe("wiki/methods/mtrf-toolbox")
  })
})
