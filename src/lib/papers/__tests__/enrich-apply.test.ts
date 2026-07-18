import { describe, it, expect } from "vitest"
import { serializeDocument, parseDocument } from "../../vault/frontmatter"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadBundle } from "../../vault/bundle"
import { deriveKnowledgeGraph } from "../../viz/graph"
import { buildEnrichMergeChangeset } from "../enrich-apply"

const PAGE = serializeDocument(
  { type: "paper", title: "Ear-EEG", created: "2026-07-17", updated: "2026-07-17", tags: [], related: [], sources: [], status: "saved" },
  "# Ear-EEG\n\n## Abstract\n\nWe study ear-EEG.\n",
)

describe("buildEnrichMergeChangeset", () => {
  // I1 (whole-branch review): related[] must store BARE slugs (the id's
  // final path segment), matching the convention every other writer in this
  // app uses (ingest's sanitizeSlugList, buildPaperPage). A full bundle id
  // like "wiki/methods/mtrf-toolbox" never resolves via resolveLink (the
  // graph's own related[] resolution), so a full-id related entry silently
  // produces no knowledge-graph edge.
  it("merges tldr/tags/related (stored as bare slugs) and flips status to enriched", () => {
    const cs = buildEnrichMergeChangeset("wiki/papers/ear-eeg", PAGE, {
      tldr: "A study of ear-EEG.", tags: ["ear-eeg", "methods"], relatedPageIds: ["wiki/methods/mtrf-toolbox"],
    })
    const after = cs.changes[0].after!
    const doc = parseDocument(after)
    expect(doc.frontmatter.status).toBe("enriched")
    expect(doc.frontmatter.tldr).toBe("A study of ear-EEG.")
    expect(doc.frontmatter.tags).toEqual(["ear-eeg", "methods"])
    expect(doc.frontmatter.related).toEqual(["mtrf-toolbox"])
    expect(cs.changes[0].before).toBe(PAGE)
  })

  it("dedupes tags/related against existing frontmatter, preserving order (related already a bare slug)", () => {
    const pageWithExisting = serializeDocument(
      { type: "paper", title: "Ear-EEG", created: "2026-07-17", updated: "2026-07-17", tags: ["auditory"], related: ["attention"], sources: [], status: "saved" },
      "# Ear-EEG\n\n## Abstract\n\nWe study ear-EEG.\n",
    )
    const cs = buildEnrichMergeChangeset("wiki/papers/ear-eeg", pageWithExisting, {
      tldr: "A study of ear-EEG.",
      tags: ["auditory", "ear-eeg"],
      relatedPageIds: ["wiki/concepts/attention", "wiki/methods/mtrf-toolbox"],
    })
    const doc = parseDocument(cs.changes[0].after!)
    expect(doc.frontmatter.tags).toEqual(["auditory", "ear-eeg"])
    expect(doc.frontmatter.related).toEqual(["attention", "mtrf-toolbox"])
  })

  it("end-to-end: an enrich-merged related[] resolves to a real knowledge-graph edge", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write("wiki/papers/ear-eeg.md", PAGE)
    await storage.write(
      "wiki/methods/mtrf-toolbox.md",
      serializeDocument(
        { type: "method", title: "mTRF Toolbox", created: "2026-07-17", updated: "2026-07-17", tags: [], related: [], sources: [] },
        "# mTRF Toolbox\n",
      ),
    )
    const cs = buildEnrichMergeChangeset("wiki/papers/ear-eeg", PAGE, {
      tldr: "A study of ear-EEG.", tags: [], relatedPageIds: ["wiki/methods/mtrf-toolbox"],
    })
    await storage.write("wiki/papers/ear-eeg.md", cs.changes[0].after!)

    const bundle = await loadBundle(storage)
    const graph = deriveKnowledgeGraph(bundle)
    const edge = graph.edges.find(
      (e) =>
        (e.source === "wiki/papers/ear-eeg" && e.target === "wiki/methods/mtrf-toolbox") ||
        (e.source === "wiki/methods/mtrf-toolbox" && e.target === "wiki/papers/ear-eeg"),
    )
    expect(edge).toBeDefined()
    expect(edge!.signals.wikilink).toBe(1)
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
