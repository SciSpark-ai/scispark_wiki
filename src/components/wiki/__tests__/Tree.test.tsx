// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"
import { Tree } from "../Tree"

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

function bundleFromPages(entries: Array<{ id: string; frontmatter: Frontmatter }>): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const e of entries) {
    pages.set(e.id, { id: e.id, path: `${e.id}.md`, frontmatter: e.frontmatter, body: "" })
  }
  return { pages, links: [], errors: [] }
}

describe("Tree paper routing (SP3 task 3)", () => {
  it("links a paper node to /paper/<slug> instead of the wiki editor route", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/ear-eeg-2409-08710", frontmatter: fm("paper", "Ear-EEG Attention") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} />)
    expect(html).toMatch(/href="\/paper\/ear-eeg-2409-08710"/)
    expect(html).not.toMatch(/href="\/wiki\/papers\/ear-eeg-2409-08710"/)
  })

  it("leaves a non-paper node's href on the wikiHref route", () => {
    const bundle = bundleFromPages([
      { id: "wiki/concepts/attention", frontmatter: fm("concept", "Attention Mechanism") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} />)
    expect(html).toMatch(/href="\/wiki\/concepts\/attention"/)
  })
})

describe("Tree type headings (SP5 task 1: reinstated 'query' type)", () => {
  it("labels a 'query' section 'Saved answers', not the raw type", () => {
    const bundle = bundleFromPages([
      { id: "wiki/queries/what-causes-x", frontmatter: fm("query", "What causes X?") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} />)
    expect(html).toContain("Saved answers")
    expect(html).not.toMatch(/>query</)
  })
})
