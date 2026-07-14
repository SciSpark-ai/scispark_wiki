import { describe, it, expect } from "vitest"
import { deriveTrackedFields, MAX_TRACKED_FIELDS, slugify } from "../fields"

const INTERESTS = `# Interests

## Active topics

- Natural Language Processing
- Retrieval-Augmented Generation
- Efficient Transformers
- Graph Neural Networks

## Rising
`

describe("deriveTrackedFields", () => {
  it("takes up to MAX_TRACKED_FIELDS active-topic bullets as {slug,label}", () => {
    const fields = deriveTrackedFields(INTERESTS)
    expect(fields.length).toBe(MAX_TRACKED_FIELDS) // 3, capped
    expect(fields[0]).toEqual({ slug: "natural-language-processing", label: "Natural Language Processing" })
    expect(fields[1]).toEqual({ slug: "retrieval-augmented-generation", label: "Retrieval-Augmented Generation" })
  })

  it("returns [] for null / missing / empty active-topics", () => {
    expect(deriveTrackedFields(null)).toEqual([])
    expect(deriveTrackedFields("# Interests\n\n## Active topics\n\n## Rising\n")).toEqual([])
  })

  it("only reads the Active topics section, not Rising/Fading", () => {
    const md = "## Active topics\n\n- Alpha\n\n## Rising\n\n- Beta\n"
    expect(deriveTrackedFields(md).map((f) => f.label)).toEqual(["Alpha"])
  })
})

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Natural Language Processing")).toBe("natural-language-processing")
    expect(slugify("  C++ & Rust!  ")).toBe("c-rust")
  })
})
