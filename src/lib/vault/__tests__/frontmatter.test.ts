import { describe, it, expect } from "vitest"
import { parseDocument, serializeDocument, FrontmatterError } from "../frontmatter"

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
})

describe("serializeDocument", () => {
  it("round-trips", () => {
    const { frontmatter, body } = parseDocument(DOC)
    const out = serializeDocument(frontmatter, body)
    const again = parseDocument(out)
    expect(again.frontmatter).toEqual(frontmatter)
    expect(again.body.trim()).toBe(body.trim())
  })
})
