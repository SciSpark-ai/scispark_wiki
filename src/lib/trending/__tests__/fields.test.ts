import { describe, it, expect } from "vitest"
import {
  deriveTrackedFields,
  effectiveTrackedFields,
  MAX_FIELD_LABEL_LEN,
  MAX_TRACKED_FIELDS,
  slugify,
  splitTopics,
} from "../fields"

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

  it("splits a single comma/semicolon-separated bullet into discrete fields (capped at MAX)", () => {
    // The onboarding mis-seed case: one free-text sentence stored as one bullet.
    const md =
      "## Active topics\n\n- cortical tracking of continuous speech, the frequency-following response (FFR); auditory attention decoding, speech envelope reconstruction\n"
    const fields = deriveTrackedFields(md)
    expect(fields.length).toBe(MAX_TRACKED_FIELDS)
    expect(fields.map((f) => f.label)).toEqual([
      "cortical tracking of continuous speech",
      "the frequency-following response (FFR)",
      "auditory attention decoding",
    ])
    expect(fields[1].slug).toBe("the-frequency-following-response-ffr")
  })

  it("dedups by slug across bullets and caps at MAX", () => {
    const md = "## Active topics\n\n- NLP, RAG\n- RAG, GNNs\n- Diffusion Models\n"
    expect(deriveTrackedFields(md).map((f) => f.label)).toEqual(["NLP", "RAG", "GNNs"])
  })

  it("truncates an over-long single topic to a clean short label at a word boundary", () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")
    const md = `## Active topics\n\n- ${long}\n`
    const [field] = deriveTrackedFields(md)
    expect(field.label.length).toBeLessThanOrEqual(MAX_FIELD_LABEL_LEN)
    expect(field.label).not.toMatch(/\s$/)
    expect(long.startsWith(field.label)).toBe(true)
  })
})

describe("splitTopics", () => {
  it("splits on commas, semicolons, and newlines into trimmed discrete topics", () => {
    expect(splitTopics("cortical tracking, the FFR; auditory attention\nspeech envelope")).toEqual([
      "cortical tracking",
      "the FFR",
      "auditory attention",
      "speech envelope",
    ])
  })

  it("drops blanks and dedups by slug", () => {
    expect(splitTopics("NLP, nlp,  , NLP ")).toEqual(["NLP"])
  })

  it("strips a leading conjunction from list tails", () => {
    expect(splitTopics("vision, and language")).toEqual(["vision", "language"])
  })

  it("returns [] for blank / empty input", () => {
    expect(splitTopics("   ")).toEqual([])
    expect(splitTopics("")).toEqual([])
  })
})

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Natural Language Processing")).toBe("natural-language-processing")
    expect(slugify("  C++ & Rust!  ")).toBe("c-rust")
  })
})

describe("effectiveTrackedFields", () => {
  it("prefers non-empty settings fields over interests.md", () => {
    const settingsFields = [{ slug: "alpha", label: "Alpha" }]
    expect(effectiveTrackedFields(settingsFields, INTERESTS)).toEqual(settingsFields)
  })

  it("falls back to deriveTrackedFields(interests) when settings fields are empty", () => {
    expect(effectiveTrackedFields([], INTERESTS)).toEqual(deriveTrackedFields(INTERESTS))
  })

  it("returns [] when both settings fields and interests are empty/null", () => {
    expect(effectiveTrackedFields([], null)).toEqual([])
  })
})
