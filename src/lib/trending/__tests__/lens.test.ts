import { describe, it, expect } from "vitest"
import type { Bundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"
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

describe("topicLens — relevance via interest labels", () => {
  it("is relevant when the topic label shares a significant term with an interest label", () => {
    const result = topicLens(
      { label: "Retrieval Augmented Generation" },
      ["Text Generation Systems"],
      emptyBundle,
    )
    // shared significant token: "generation"
    expect(result.relevant).toBe(true)
  })

  it("is not relevant when the only shared token is a stopword", () => {
    const result = topicLens(
      { label: "Data Analysis With Models" },
      ["Model Data From Surveys"],
      emptyBundle,
    )
    // shared tokens are "data"/"model(s)"/"from" — all in the stopword set, no significant overlap
    expect(result.relevant).toBe(false)
  })

  it("is not relevant when the only shared token is <=3 characters", () => {
    const result = topicLens(
      { label: "Ant Colony Optimization" },
      ["Ant Farm Robotics"],
      emptyBundle,
    )
    // "ant" is 3 chars, dropped by the length filter; no other overlap
    expect(result.relevant).toBe(false)
  })

  it("ignores case and punctuation when matching", () => {
    const result = topicLens(
      { label: "GRAPH-Neural, Networks!" },
      ["graph neural nets"],
      emptyBundle,
    )
    // "graph" and "neural" survive tokenization on both sides regardless of case/punctuation
    expect(result.relevant).toBe(true)
  })

  it("is not relevant when there is no significant token overlap at all", () => {
    const result = topicLens(
      { label: "Quantum Computing Hardware" },
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
      { label: "Retrieval Augmented Generation" },
      ["Completely Unrelated Interest"],
      bundle,
    )
    expect(result.relevant).toBe(true)
  })
})

describe("topicLens — empty inputs", () => {
  it("empty interests + empty bundle yields not relevant", () => {
    const result = topicLens({ label: "Anything At All" }, [], emptyBundle)
    expect(result).toEqual({ relevant: false })
  })
})

describe("topicLens — output shape", () => {
  // The lens used to ALSO resolve a topic's representative papers to wiki page
  // ids, which every caller discarded (dashboard.ts resolves the link it
  // actually renders per-paper). This asserts the surface stayed collapsed:
  // relevance only, and no paper input at all.
  it("returns exactly one field — relevance — and nothing paper-shaped", () => {
    const result = topicLens({ label: "Retrieval Augmented Generation" }, ["Retrieval Systems"], emptyBundle)
    expect(Object.keys(result)).toEqual(["relevant"])
    expect(result.relevant).toBe(true)
  })
})
