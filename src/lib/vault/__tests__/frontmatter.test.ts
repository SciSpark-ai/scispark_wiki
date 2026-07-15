import { describe, it, expect } from "vitest"
import { parseDocument, serializeDocument, FrontmatterError } from "../frontmatter"
import type { Frontmatter } from "../types"

const DOC = `---
type: concept
title: "Sparse Autoencoders"
created: 2026-07-11
updated: 2026-07-11
tags: [interpretability, ml]
related: [superposition]
sources: ["2406.01234.pdf"]
---

# Sparse Autoencoders

Body with a [[superposition]] link.
`

describe("parseDocument", () => {
  it("parses frontmatter and body", () => {
    const { frontmatter, body } = parseDocument(DOC)
    expect(frontmatter.type).toBe("concept")
    expect(frontmatter.title).toBe("Sparse Autoencoders")
    expect(frontmatter.tags).toEqual(["interpretability", "ml"])
    expect(frontmatter.sources).toEqual(["2406.01234.pdf"])
    expect(body).toContain("# Sparse Autoencoders")
    expect(body.startsWith("---")).toBe(false)
  })

  it("throws on missing required keys", () => {
    expect(() => parseDocument(`---\ntitle: x\n---\nbody`)).toThrow(FrontmatterError)
  })

  it("throws when file does not start with ---", () => {
    expect(() => parseDocument(`# no frontmatter`)).toThrow(FrontmatterError)
  })

  it("parses CRLF-encoded documents identically to LF documents", () => {
    const crlfDoc = DOC.replace(/\n/g, "\r\n")
    const lf = parseDocument(DOC)
    const crlf = parseDocument(crlfDoc)
    expect(crlf.frontmatter).toEqual(lf.frontmatter)
    expect(crlf.body).toBe(lf.body)
  })

  it("keeps a ----- horizontal rule in the body intact after the proper --- terminator", () => {
    const docWithRule = DOC.replace(
      "# Sparse Autoencoders",
      "# Sparse Autoencoders\n\n-----\n\nMore body text.",
    )
    const { body } = parseDocument(docWithRule)
    expect(body).toContain("-----")
    expect(body).not.toContain("--\n\n-----")
  })

  it("does not treat a ----- line as a valid frontmatter terminator", () => {
    const badlyTerminated = `---
type: concept
title: "Sparse Autoencoders"
created: 2026-07-11
updated: 2026-07-11
tags: [interpretability, ml]
related: [superposition]
sources: ["2406.01234.pdf"]
-----

Body text here
`
    expect(() => parseDocument(badlyTerminated)).toThrow(FrontmatterError)
  })

  it("treats --- with trailing whitespace as a valid terminator", () => {
    const trailingSpace = `---
type: concept
title: "Sparse Autoencoders"
created: 2026-07-11
updated: 2026-07-11
tags: [interpretability, ml]
related: [superposition]
sources: ["2406.01234.pdf"]
---${"  "}

Body text here
`
    const { frontmatter, body } = parseDocument(trailingSpace)
    expect(frontmatter.title).toBe("Sparse Autoencoders")
    expect(body).toContain("Body text here")
  })
})

describe("serializeDocument", () => {
  it("round-trips", () => {
    const { frontmatter, body } = parseDocument(DOC)
    const out = serializeDocument(frontmatter, body)
    const again = parseDocument(out)
    expect(again.frontmatter).toEqual(frontmatter)
    expect(again.body.trim()).toBe(body.trim())
  })

  it("serialize∘parse is byte-identical for normal body", () => {
    const fm: Frontmatter = {
      type: "concept",
      title: "Test Page",
      created: "2026-07-11",
      updated: "2026-07-11",
      tags: [],
      related: [],
      sources: [],
    }
    const body = "# Heading\n\nSome content here."
    const original = serializeDocument(fm, body)
    const parsed = parseDocument(original)
    const roundtrip = serializeDocument(parsed.frontmatter, parsed.body)
    expect(roundtrip).toBe(original)
  })

  it("serialize∘parse is byte-identical for empty body", () => {
    const fm: Frontmatter = {
      type: "concept",
      title: "Empty Page",
      created: "2026-07-11",
      updated: "2026-07-11",
      tags: [],
      related: [],
      sources: [],
    }
    const body = ""
    const original = serializeDocument(fm, body)
    const parsed = parseDocument(original)
    const roundtrip = serializeDocument(parsed.frontmatter, parsed.body)
    expect(roundtrip).toBe(original)
  })

  it("serialize∘parse is byte-identical for body with author-intended leading blank line", () => {
    const fm: Frontmatter = {
      type: "concept",
      title: "Blank Line Page",
      created: "2026-07-11",
      updated: "2026-07-11",
      tags: [],
      related: [],
      sources: [],
    }
    const body = "\n# Heading after blank\n\nContent."
    const original = serializeDocument(fm, body)
    const parsed = parseDocument(original)
    const roundtrip = serializeDocument(parsed.frontmatter, parsed.body)
    expect(roundtrip).toBe(original)
  })

  it("serialize∘parse is byte-identical for single-line body", () => {
    const fm: Frontmatter = {
      type: "concept",
      title: "One Liner",
      created: "2026-07-11",
      updated: "2026-07-11",
      tags: [],
      related: [],
      sources: [],
    }
    const body = "Just one line"
    const original = serializeDocument(fm, body)
    const parsed = parseDocument(original)
    const roundtrip = serializeDocument(parsed.frontmatter, parsed.body)
    expect(roundtrip).toBe(original)
  })
})
