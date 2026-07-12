import { describe, it, expect } from "vitest"
import { parseDocument } from "../../vault/frontmatter"
import type { PaperRecord } from "../../papers/types"
import {
  slugifyTitle,
  paperSlug,
  buildPaperPage,
  buildAuthorSkeletons,
  composePage,
} from "../authoring"

function paper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ids: {},
    title: "Attention Is All You Need",
    authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

describe("slugifyTitle", () => {
  it("lowercases and kebab-cases a plain title", () => {
    expect(slugifyTitle("Attention Is All You Need")).toBe("attention-is-all-you-need")
  })

  it("collapses punctuation runs to a single dash", () => {
    expect(slugifyTitle("Hello, World!!  --  Foo???")).toBe("hello-world-foo")
  })

  it("preserves CJK characters", () => {
    expect(slugifyTitle("深度学习 Deep Learning")).toBe("深度学习-deep-learning")
  })

  it("trims leading and trailing dashes", () => {
    expect(slugifyTitle("!!!Wrapped in punctuation!!!")).toBe("wrapped-in-punctuation")
  })

  it("returns 'untitled' for an empty string", () => {
    expect(slugifyTitle("")).toBe("untitled")
  })

  it("returns 'untitled' for a punctuation-only string", () => {
    expect(slugifyTitle("!!! ??? ---")).toBe("untitled")
  })

  it("caps at 80 characters, cutting at a dash boundary when possible", () => {
    // Twelve 8-char words separated by spaces -> the kebabbed slug (dashes
    // in place of spaces) is well over 80 raw chars.
    const words = Array.from({ length: 12 }, (_, i) => `word${String(i).padStart(4, "0")}`)
    const title = words.join(" ")
    const fullSlug = words.join("-")
    const slug = slugifyTitle(title)
    expect(slug.length).toBeLessThanOrEqual(80)
    // Boundary cut means it ends on a whole word, not a truncated one, and
    // is a whole-word prefix of the uncapped slug.
    expect(slug.endsWith("-")).toBe(false)
    expect(fullSlug.startsWith(slug)).toBe(true)
    expect(slug.split("-").every((w) => /^word\d{4}$/.test(w))).toBe(true)
  })

  it("hard-cuts at 80 characters when there is no dash to back up to", () => {
    const title = "a".repeat(120)
    const slug = slugifyTitle(title)
    expect(slug).toBe("a".repeat(80))
  })

  it("exactly 80 characters passes through unchanged", () => {
    const title = "a".repeat(80)
    expect(slugifyTitle(title)).toBe(title)
    expect(slugifyTitle(title).length).toBe(80)
  })
})

describe("paperSlug", () => {
  it("prefers arxiv id, converting dots and slashes to dashes", () => {
    const p = paper({ ids: { arxiv: "2406.01234" } })
    expect(paperSlug(p)).toBe("2406-01234")
  })

  it("handles a legacy slash-form arxiv id", () => {
    const p = paper({ ids: { arxiv: "math/0211159" } })
    expect(paperSlug(p)).toBe("math-0211159")
  })

  it("falls back to a slugified doi when there is no arxiv id", () => {
    const p = paper({ ids: { doi: "10.1038/nature123" } })
    expect(paperSlug(p)).toBe("10-1038-nature123")
  })

  it("prefers arxiv over doi when both are present", () => {
    const p = paper({ ids: { arxiv: "2406.01234", doi: "10.1038/nature123" } })
    expect(paperSlug(p)).toBe("2406-01234")
  })

  it("falls back to the slugified title when there is no arxiv or doi", () => {
    const p = paper({ ids: {}, title: "A Great Paper About Things" })
    expect(paperSlug(p)).toBe("a-great-paper-about-things")
  })
})

describe("buildPaperPage", () => {
  it("writes to wiki/papers/<paperSlug>.md", () => {
    const p = paper({ ids: { arxiv: "2406.01234" } })
    const draft = buildPaperPage(p, { fullText: false, today: "2026-07-11" })
    expect(draft.path).toBe("wiki/papers/2406-01234.md")
  })

  it("sets the base frontmatter contract fields", () => {
    const p = paper()
    const draft = buildPaperPage(p, { fullText: true, today: "2026-07-11" })
    expect(draft.frontmatter.type).toBe("paper")
    expect(draft.frontmatter.title).toBe("Attention Is All You Need")
    expect(draft.frontmatter.created).toBe("2026-07-11")
    expect(draft.frontmatter.updated).toBe("2026-07-11")
    expect(draft.frontmatter.tags).toEqual([])
    expect(draft.frontmatter.related).toEqual([])
    expect(draft.frontmatter.sources).toEqual([])
    expect(draft.frontmatter.authors).toEqual(["Ashish Vaswani", "Noam Shazeer"])
    expect(draft.frontmatter.projects).toEqual([])
    expect(draft.frontmatter.full_text).toBe(true)
  })

  it("passes through opts.sources and opts.projects when given", () => {
    const p = paper()
    const draft = buildPaperPage(p, {
      fullText: false,
      today: "2026-07-11",
      sources: ["sources/foo.html"],
      projects: ["scispark"],
    })
    expect(draft.frontmatter.sources).toEqual(["sources/foo.html"])
    expect(draft.frontmatter.projects).toEqual(["scispark"])
  })

  it("includes doi/arxiv/openalex/pmid only when defined", () => {
    const withIds = paper({ ids: { doi: "10.1/x", arxiv: "2406.01234", openalex: "W123", pmid: "999" } })
    const draftWithIds = buildPaperPage(withIds, { fullText: false, today: "2026-07-11" })
    expect(draftWithIds.frontmatter.doi).toBe("10.1/x")
    expect(draftWithIds.frontmatter.arxiv).toBe("2406.01234")
    expect(draftWithIds.frontmatter.openalex).toBe("W123")
    expect(draftWithIds.frontmatter.pmid).toBe("999")

    const noIds = paper({ ids: {} })
    const draftNoIds = buildPaperPage(noIds, { fullText: false, today: "2026-07-11" })
    expect("doi" in draftNoIds.frontmatter).toBe(false)
    expect("arxiv" in draftNoIds.frontmatter).toBe(false)
    expect("openalex" in draftNoIds.frontmatter).toBe(false)
    expect("pmid" in draftNoIds.frontmatter).toBe(false)
  })

  it("includes year/venue only when defined", () => {
    const withBoth = paper({ year: 2017, venue: "NeurIPS" })
    const draftWithBoth = buildPaperPage(withBoth, { fullText: false, today: "2026-07-11" })
    expect(draftWithBoth.frontmatter.year).toBe(2017)
    expect(draftWithBoth.frontmatter.venue).toBe("NeurIPS")

    const neither = paper({ year: undefined, venue: undefined })
    const draftNeither = buildPaperPage(neither, { fullText: false, today: "2026-07-11" })
    expect("year" in draftNeither.frontmatter).toBe(false)
    expect("venue" in draftNeither.frontmatter).toBe(false)
  })

  describe("body sections", () => {
    it("always starts with the title H1", () => {
      const draft = buildPaperPage(paper(), { fullText: false, today: "2026-07-11" })
      expect(draft.body.startsWith("# Attention Is All You Need\n")).toBe(true)
    })

    it("omits the Digest section when no digest is given", () => {
      const draft = buildPaperPage(paper(), { fullText: false, today: "2026-07-11" })
      expect(draft.body).not.toContain("## Digest")
    })

    it("renders a Digest section with only the fields present", () => {
      const draft = buildPaperPage(paper(), {
        fullText: false,
        today: "2026-07-11",
        digest: { summary: "A concise summary." },
      })
      expect(draft.body).toContain("## Digest")
      expect(draft.body).toContain("A concise summary.")
      expect(draft.body).not.toContain("**Key points**")
      expect(draft.body).not.toContain("**Lay summary**")
      expect(draft.body).not.toContain("**Methods**")
      expect(draft.body).not.toContain("**Limitations**")
    })

    it("renders all Digest sub-sections when all fields are present", () => {
      const draft = buildPaperPage(paper(), {
        fullText: false,
        today: "2026-07-11",
        digest: {
          summary: "Summary text.",
          keyPoints: ["Point one", "Point two"],
          laySummary: "Lay text.",
          methods: "Methods text.",
          limitations: "Limitations text.",
        },
      })
      const body = draft.body
      expect(body).toContain("## Digest")
      expect(body).toContain("Summary text.")
      expect(body).toContain("**Key points**")
      expect(body).toContain("- Point one")
      expect(body).toContain("- Point two")
      expect(body).toContain("**Lay summary**")
      expect(body).toContain("Lay text.")
      expect(body).toContain("**Methods**")
      expect(body).toContain("Methods text.")
      expect(body).toContain("**Limitations**")
      expect(body).toContain("Limitations text.")
      // Order: summary -> key points -> lay summary -> methods -> limitations
      expect(body.indexOf("Summary text.")).toBeLessThan(body.indexOf("**Key points**"))
      expect(body.indexOf("**Key points**")).toBeLessThan(body.indexOf("**Lay summary**"))
      expect(body.indexOf("**Lay summary**")).toBeLessThan(body.indexOf("**Methods**"))
      expect(body.indexOf("**Methods**")).toBeLessThan(body.indexOf("**Limitations**"))
    })

    it("omits keyPoints bullet list when the array is empty", () => {
      const draft = buildPaperPage(paper(), {
        fullText: false,
        today: "2026-07-11",
        digest: { summary: "x", keyPoints: [] },
      })
      expect(draft.body).not.toContain("**Key points**")
    })

    it("omits the Abstract section when there is no abstract", () => {
      const draft = buildPaperPage(paper({ abstract: undefined }), { fullText: false, today: "2026-07-11" })
      expect(draft.body).not.toContain("## Abstract")
    })

    it("renders the Abstract section when present", () => {
      const draft = buildPaperPage(paper({ abstract: "This paper studies attention." }), {
        fullText: false,
        today: "2026-07-11",
      })
      expect(draft.body).toContain("## Abstract")
      expect(draft.body).toContain("This paper studies attention.")
    })

    it("omits the Links section when there are no links", () => {
      const draft = buildPaperPage(paper({ ids: {}, oaUrl: undefined, pdfUrl: undefined }), {
        fullText: false,
        today: "2026-07-11",
      })
      expect(draft.body).not.toContain("## Links")
    })

    it("renders only the defined link kinds", () => {
      const draft = buildPaperPage(
        paper({ ids: { doi: "10.1/x" }, oaUrl: "https://example.com/oa" }),
        { fullText: false, today: "2026-07-11" },
      )
      expect(draft.body).toContain("## Links")
      expect(draft.body).toContain("[10.1/x](https://doi.org/10.1/x)")
      expect(draft.body).toContain("https://example.com/oa")
      expect(draft.body).not.toContain("arXiv:")
      expect(draft.body).not.toContain("PDF:")
    })

    it("renders all four link kinds when all are present", () => {
      const draft = buildPaperPage(
        paper({
          ids: { doi: "10.1/x", arxiv: "2406.01234" },
          oaUrl: "https://example.com/oa",
          pdfUrl: "https://example.com/paper.pdf",
        }),
        { fullText: false, today: "2026-07-11" },
      )
      expect(draft.body).toContain("[10.1/x](https://doi.org/10.1/x)")
      expect(draft.body).toContain("[2406.01234](https://arxiv.org/abs/2406.01234)")
      expect(draft.body).toContain("https://example.com/oa")
      expect(draft.body).toContain("https://example.com/paper.pdf")
    })
  })

  it("is a pure function (same input -> same output, no mutation)", () => {
    const p = paper()
    const opts = { fullText: false, today: "2026-07-11" }
    const d1 = buildPaperPage(p, opts)
    const d2 = buildPaperPage(p, opts)
    expect(d1).toEqual(d2)
  })

  it("composePage output re-parses via parseDocument with identical frontmatter", () => {
    const p = paper({
      ids: { doi: "10.1/x", arxiv: "2406.01234", openalex: "W1", pmid: "1" },
      abstract: "An abstract.",
      year: 2020,
      venue: "ICML",
      oaUrl: "https://example.com/oa",
      pdfUrl: "https://example.com/pdf",
    })
    const draft = buildPaperPage(p, {
      fullText: true,
      today: "2026-07-11",
      sources: ["sources/x.html"],
      projects: ["proj-a"],
      digest: {
        summary: "s",
        keyPoints: ["k1"],
        laySummary: "l",
        methods: "m",
        limitations: "lim",
      },
    })
    const serialized = composePage(draft)
    const parsed = parseDocument(serialized)
    expect(parsed.frontmatter).toEqual(draft.frontmatter)
    expect(parsed.body.trim()).toBe(draft.body.trim())
  })
})

describe("buildAuthorSkeletons", () => {
  it("produces one skeleton per author, slugged by openalexId when present", () => {
    const p = paper({
      authors: [
        { name: "Ashish Vaswani", openalexId: "A5001" },
        { name: "Noam Shazeer" },
      ],
    })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect(drafts).toHaveLength(2)
    expect(drafts[0].path).toBe("wiki/authors/a5001.md")
    expect(drafts[1].path).toBe("wiki/authors/noam-shazeer.md")
  })

  it("lowercases the openalexId slug", () => {
    const p = paper({ authors: [{ name: "Ashish Vaswani", openalexId: "A5001XYZ" }] })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect(drafts[0].path).toBe("wiki/authors/a5001xyz.md")
  })

  it("sets author frontmatter: type, title, sources, openalex when present", () => {
    const p = paper({ authors: [{ name: "Ashish Vaswani", openalexId: "A5001" }] })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    const fm = drafts[0].frontmatter
    expect(fm.type).toBe("author")
    expect(fm.title).toBe("Ashish Vaswani")
    expect(fm.created).toBe("2026-07-11")
    expect(fm.updated).toBe("2026-07-11")
    expect(fm.tags).toEqual([])
    expect(fm.related).toEqual([])
    expect(fm.sources).toEqual([])
    expect(fm.openalex).toBe("A5001")
  })

  it("omits the openalex field when the author has no openalexId", () => {
    const p = paper({ authors: [{ name: "Noam Shazeer" }] })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect("openalex" in drafts[0].frontmatter).toBe(false)
  })

  it("builds the name-slugified path for an author with no openalexId", () => {
    const p = paper({ authors: [{ name: "Noam Shazeer" }] })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect(drafts[0].path).toBe("wiki/authors/noam-shazeer.md")
  })

  it("body links to the paper page via wikilink", () => {
    const p = paper({ authors: [{ name: "Noam Shazeer" }] })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect(drafts[0].body).toBe(
      "# Noam Shazeer\n\n## Papers\n\n- [[attention-is-all-you-need]]\n",
    )
  })

  it("skips an author whose page id is already in existingIds", () => {
    const p = paper({
      authors: [
        { name: "Ashish Vaswani", openalexId: "A5001" },
        { name: "Noam Shazeer" },
      ],
    })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(["wiki/authors/a5001"]),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0].path).toBe("wiki/authors/noam-shazeer.md")
  })

  it("skips a name-slugged author already present", () => {
    const p = paper({ authors: [{ name: "Noam Shazeer" }] })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(["wiki/authors/noam-shazeer"]),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect(drafts).toHaveLength(0)
  })

  it("returns an empty array when a paper has no authors", () => {
    const p = paper({ authors: [] })
    const drafts = buildAuthorSkeletons(p, {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })
    expect(drafts).toEqual([])
  })
})

describe("composePage", () => {
  it("serializes a draft into a document that round-trips via parseDocument", () => {
    const draft = buildAuthorSkeletons(paper({ authors: [{ name: "Noam Shazeer" }] }), {
      existingIds: new Set(),
      today: "2026-07-11",
      paperPageSlug: "attention-is-all-you-need",
    })[0]
    const serialized = composePage(draft)
    expect(serialized.startsWith("---\n")).toBe(true)
    const parsed = parseDocument(serialized)
    expect(parsed.frontmatter).toEqual(draft.frontmatter)
  })
})
