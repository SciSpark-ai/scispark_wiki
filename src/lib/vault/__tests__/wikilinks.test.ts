import { describe, it, expect } from "vitest"
import { extractWikilinks } from "../wikilinks"

describe("extractWikilinks", () => {
  it("finds plain and labeled links, deduped", () => {
    expect(extractWikilinks("See [[saint-protocol]] and [[tms|TMS therapy]] and [[saint-protocol]].")).toEqual([
      "saint-protocol",
      "tms",
    ])
  })
  it("ignores code fences and inline code", () => {
    const body = "```\n[[not-a-link]]\n```\nand `[[also-not]]` but [[real]]"
    expect(extractWikilinks(body)).toEqual(["real"])
  })
  it("masks through end-of-string when a code fence is never closed", () => {
    expect(extractWikilinks("```\n[[leaked]]\n")).toEqual([])
  })
})
