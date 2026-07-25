import { describe, it, expect } from "vitest"
import type { Bundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"
import type { PaperRecord } from "../../papers/types"
import { topicLens } from "../lens"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags: [],
  related: [],
  sources: [],
  ...extra,
})

function bundleFromPages(
  entries: Array<{ id: string; frontmatter: Frontmatter; body?: string }>,
): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const e of entries) {
    pages.set(e.id, {
      id: e.id,
      path: `${e.id}.md`,
      frontmatter: e.frontmatter,
      body: e.body ?? "",
    })
  }
  return { pages, links: [], errors: [] }
}

const emptyBundle: Bundle = { pages: new Map(), links: [], errors: [] }

function paper(overrides: Partial<PaperRecord> & { arxiv?: string } = {}): PaperRecord {
  const { arxiv, ...rest } = overrides
  return {
    ids: arxiv ? { arxiv } : {},
    title: "Untitled paper",
    authors: [],
    fields: [],
    source: "arxiv",
    ...rest,
  }
}

describe("topicLens — relevance via interest labels", () => {
  it("is relevant when the topic label shares a significant term with an interest label", () => {
    const result = topicLens(
      { label: "Retrieval Augmented Generation", papers: [] },
      ["Text Generation Systems"],
      emptyBundle,
    )
    // shared significant token: "generation"
    expect(result.relevant).toBe(true)
  })

  it("is not relevant when the only shared token is a stopword", () => {
    const result = topicLens(
      { label: "Data Analysis With Models", papers: [] },
      ["Model Data From Surveys"],
      emptyBundle,
    )
    // shared tokens are "data"/"model(s)"/"from" — all in the stopword set, no significant overlap
    expect(result.relevant).toBe(false)
  })

  it("is not relevant when the only shared token is <=3 characters", () => {
    const result = topicLens(
      { label: "Ant Colony Optimization", papers: [] },
      ["Ant Farm Robotics"],
      emptyBundle,
    )
    // "ant" is 3 chars, dropped by the length filter; no other overlap
    expect(result.relevant).toBe(false)
  })

  it("ignores case and punctuation when matching", () => {
    const result = topicLens(
      { label: "GRAPH-Neural, Networks!", papers: [] },
      ["graph neural nets"],
      emptyBundle,
    )
    // "graph" and "neural" survive tokenization on both sides regardless of case/punctuation
    expect(result.relevant).toBe(true)
  })

  it("is not relevant when there is no significant token overlap at all", () => {
    const result = topicLens(
      { label: "Quantum Computing Hardware", papers: [] },
      ["Coral Reef Ecology"],
      emptyBundle,
    )
    expect(result.relevant).toBe(false)
  })
})

describe("topicLens — relevance via wiki page tags", () => {
  it("is relevant when a wiki page tag (not an interest label) shares a significant term", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/concepts/rag",
        frontmatter: fm("concept", "RAG", { tags: ["retrieval-augmented-generation"] }),
      },
    ])
    const result = topicLens(
      { label: "Retrieval Augmented Generation", papers: [] },
      ["Completely Unrelated Interest"],
      bundle,
    )
    expect(result.relevant).toBe(true)
  })
})

describe("topicLens — empty inputs", () => {
  it("empty interests + empty bundle yields not relevant and no page ids", () => {
    const result = topicLens({ label: "Anything At All", papers: [] }, [], emptyBundle)
    expect(result).toEqual({ relevant: false, wikiPageIds: [] })
  })
})

describe("topicLens — wikiPageIds resolution", () => {
  it("resolves representative papers that exist in the vault, in order, without duplicates", () => {
    const p1 = paper({ arxiv: "2409.08710", title: "Paper One" })
    const p2 = paper({ arxiv: "2410.00001", title: "Paper Two" })
    const bundle = bundleFromPages([
      { id: "wiki/papers/2409-08710", frontmatter: fm("paper", "Paper One") },
      { id: "wiki/papers/2410-00001", frontmatter: fm("paper", "Paper Two") },
    ])
    const result = topicLens({ label: "Some Topic", papers: [p1, p2, p1] }, [], bundle)
    expect(result.wikiPageIds).toEqual(["wiki/papers/2409-08710", "wiki/papers/2410-00001"])
  })

  it("yields an empty array for papers absent from the vault", () => {
    const p1 = paper({ arxiv: "9999.99999", title: "Missing Paper" })
    const result = topicLens({ label: "Some Topic", papers: [p1] }, [], emptyBundle)
    expect(result.wikiPageIds).toEqual([])
  })
})
