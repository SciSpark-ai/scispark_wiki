import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import Inspector from "../Inspector"
import VizWorkspace from "../VizWorkspace"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"

function fm(type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter {
  return { type, title, created: "2024-01-01", updated: "2024-01-01", tags: [], related: [], sources: [], ...extra }
}

function page(id: string, frontmatter: Frontmatter, body = ""): WikiPage {
  return { id, path: `${id}.md`, frontmatter, body }
}

function bundleOf(pages: WikiPage[], links: Array<{ from: string; to: string }> = []): Bundle {
  return { pages: new Map(pages.map((p) => [p.id, p])), links, errors: [] }
}

const NOOP = () => {}

describe("Inspector", () => {
  it("renders title, type badge, tags, and backlink count", () => {
    const bundle = bundleOf(
      [
        page("wiki/concepts/sae", fm("concept", "Sparse Autoencoders", { tags: ["interpretability", "sparsity"] })),
        page("wiki/papers/p1", fm("paper", "Paper One")),
      ],
      [{ from: "wiki/papers/p1", to: "wiki/concepts/sae" }],
    )
    const html = renderToStaticMarkup(
      <Inspector bundle={bundle} id="wiki/concepts/sae" neighbors={[]} onSelect={NOOP} onClose={NOOP} />,
    )
    expect(html).toContain("Sparse Autoencoders")
    expect(html).toContain("concept")
    expect(html).toContain("interpretability")
    expect(html).toContain("sparsity")
    expect(html).toContain("1 backlink")
  })

  it("shows the paper's tldr and a footer link to /paper/<slug>", () => {
    const bundle = bundleOf([
      page("wiki/papers/attention-paper", fm("paper", "Attention Is All You Need", { tldr: "Introduces the Transformer architecture." })),
    ])
    const html = renderToStaticMarkup(
      <Inspector bundle={bundle} id="wiki/papers/attention-paper" neighbors={[]} onSelect={NOOP} onClose={NOOP} />,
    )
    expect(html).toContain("Introduces the Transformer architecture.")
    expect(html).toContain('href="/paper/attention-paper"')
    expect(html).toContain("Open paper page")
    expect(html).toContain('href="/wiki/papers/attention-paper"')
  })

  it("falls back to the first ~280 body chars for non-paper types (no tldr field)", () => {
    const longBody = "A".repeat(400)
    const bundle = bundleOf([page("wiki/concepts/big", fm("concept", "Big Concept"), longBody)])
    const html = renderToStaticMarkup(
      <Inspector bundle={bundle} id="wiki/concepts/big" neighbors={[]} onSelect={NOOP} onClose={NOOP} />,
    )
    expect(html).toContain("A".repeat(280))
    expect(html).not.toContain("A".repeat(281))
    // Non-paper: no "Open paper page" footer link.
    expect(html).not.toContain("Open paper page")
  })

  it("renders clickable neighbor buttons showing each neighbor's displayTitle", () => {
    const bundle = bundleOf([
      page("wiki/concepts/a", fm("concept", "Concept A")),
      page("wiki/concepts/b", fm("concept", "Concept B")),
    ])
    const html = renderToStaticMarkup(
      <Inspector bundle={bundle} id="wiki/concepts/a" neighbors={["wiki/concepts/b"]} onSelect={NOOP} onClose={NOOP} />,
    )
    expect(html).toContain("<button")
    expect(html).toContain("Concept B")
  })
})

describe("VizWorkspace + Inspector wiring", () => {
  function fixtureBundle(): Bundle {
    return bundleOf([
      page("wiki/concepts/a", fm("concept", "Concept A")),
      page("wiki/concepts/b", fm("concept", "Concept B")),
    ])
  }

  it("renders the Inspector when selectedId resolves to a page in the filtered bundle", () => {
    const bundle = fixtureBundle()
    const html = renderToStaticMarkup(
      <VizWorkspace
        bundle={bundle}
        refsByPageId={null}
        citationFetchState="idle"
        onFetchCitations={NOOP}
        onRecompute={NOOP}
        busy={false}
        initialSelectedId="wiki/concepts/a"
      />,
    )
    expect(html).toContain("Concept A")
  })

  it("does not render the Inspector when selectedId is filtered out of the bundle", () => {
    const bundle = fixtureBundle()
    const html = renderToStaticMarkup(
      <VizWorkspace
        bundle={bundle}
        refsByPageId={null}
        citationFetchState="idle"
        onFetchCitations={NOOP}
        onRecompute={NOOP}
        busy={false}
        initialSelectedId="wiki/concepts/does-not-exist"
      />,
    )
    expect(html).not.toContain("Open wiki page")
  })
})
