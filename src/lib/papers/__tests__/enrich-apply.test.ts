import { describe, it, expect } from "vitest"
import { serializeDocument, parseDocument } from "../../vault/frontmatter"
import { buildEnrichMergeChangeset } from "../enrich-apply"

const PAGE = serializeDocument(
  { type: "paper", title: "Ear-EEG", created: "2026-07-17", updated: "2026-07-17", tags: [], related: [], sources: [], status: "saved" },
  "# Ear-EEG\n\n## Abstract\n\nWe study ear-EEG.\n",
)

describe("buildEnrichMergeChangeset", () => {
  it("merges tldr/tags/related and flips status to enriched", () => {
    const cs = buildEnrichMergeChangeset("wiki/papers/ear-eeg", PAGE, {
      tldr: "A study of ear-EEG.", tags: ["ear-eeg", "methods"], relatedPageIds: ["wiki/methods/mtrf-toolbox"],
    })
    const after = cs.changes[0].after!
    const doc = parseDocument(after)
    expect(doc.frontmatter.status).toBe("enriched")
    expect(doc.frontmatter.tldr).toBe("A study of ear-EEG.")
    expect(doc.frontmatter.tags).toEqual(["ear-eeg", "methods"])
    expect(doc.frontmatter.related).toEqual(["wiki/methods/mtrf-toolbox"])
    expect(cs.changes[0].before).toBe(PAGE)
  })

  it("dedupes tags/related against existing frontmatter, preserving order", () => {
    const pageWithExisting = serializeDocument(
      { type: "paper", title: "Ear-EEG", created: "2026-07-17", updated: "2026-07-17", tags: ["auditory"], related: ["wiki/concepts/attention"], sources: [], status: "saved" },
      "# Ear-EEG\n\n## Abstract\n\nWe study ear-EEG.\n",
    )
    const cs = buildEnrichMergeChangeset("wiki/papers/ear-eeg", pageWithExisting, {
      tldr: "A study of ear-EEG.",
      tags: ["auditory", "ear-eeg"],
      relatedPageIds: ["wiki/concepts/attention", "wiki/methods/mtrf-toolbox"],
    })
    const doc = parseDocument(cs.changes[0].after!)
    expect(doc.frontmatter.tags).toEqual(["auditory", "ear-eeg"])
    expect(doc.frontmatter.related).toEqual(["wiki/concepts/attention", "wiki/methods/mtrf-toolbox"])
  })

  it("never downgrades an ingested page to enriched, but still merges tldr/tags", () => {
    const ingestedPage = serializeDocument(
      { type: "paper", title: "Ear-EEG", created: "2026-07-17", updated: "2026-07-17", tags: ["prior"], related: [], sources: [], status: "ingested" },
      "# Ear-EEG\n\n## Abstract\n\nWe study ear-EEG.\n",
    )
    const cs = buildEnrichMergeChangeset("wiki/papers/ear-eeg", ingestedPage, {
      tldr: "A study of ear-EEG.", tags: ["ear-eeg"], relatedPageIds: [],
    })
    const doc = parseDocument(cs.changes[0].after!)
    expect(doc.frontmatter.status).toBe("ingested")
    expect(doc.frontmatter.tldr).toBe("A study of ear-EEG.")
    expect(doc.frontmatter.tags).toEqual(["prior", "ear-eeg"])
  })

  it("leaves the body untouched and stamps skill/path metadata on the changeset", () => {
    const cs = buildEnrichMergeChangeset("wiki/papers/ear-eeg", PAGE, {
      tldr: "A study of ear-EEG.", tags: [], relatedPageIds: [],
    })
    const doc = parseDocument(cs.changes[0].after!)
    expect(doc.body).toBe(parseDocument(PAGE).body)
    expect(cs.skill).toBe("enrich")
    expect(cs.changes[0].path).toBe("wiki/papers/ear-eeg.md")
  })
})
