import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import VizWorkspace from "../VizWorkspace"
import { FilterBar } from "../FilterBar"
import { filterOptions, EMPTY_FILTERS, type VizFilters } from "@/lib/viz/filter"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"

function fm(type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter {
  return { type, title, created: "2024-01-01", updated: "2024-01-01", tags: [], related: [], sources: [], ...extra }
}

function page(id: string, frontmatter: Frontmatter, body = ""): WikiPage {
  return { id, path: `${id}.md`, frontmatter, body }
}

function bundleOf(pages: WikiPage[]): Bundle {
  return { pages: new Map(pages.map((p) => [p.id, p])), links: [], errors: [] }
}

const NOOP = () => {}

describe("VizWorkspace", () => {
  it("renders the toolbar with all four lens labels", () => {
    const bundle = bundleOf([page("wiki/papers/p1", fm("paper", "Paper One"))])
    const html = renderToStaticMarkup(
      <VizWorkspace
        bundle={bundle}
        refsByPageId={null}
        citationFetchState="idle"
        onFetchCitations={NOOP}
        onRecompute={NOOP}
        busy={false}
      />,
    )
    expect(html).toContain("Graph")
    expect(html).toContain("Timeline")
    expect(html).toContain("Citations")
    expect(html).toContain("Authors")
  })

  it("preserves the empty-vault 'Nothing to visualize yet' state", () => {
    const bundle = bundleOf([])
    const html = renderToStaticMarkup(
      <VizWorkspace
        bundle={bundle}
        refsByPageId={null}
        citationFetchState="idle"
        onFetchCitations={NOOP}
        onRecompute={NOOP}
        busy={false}
      />,
    )
    expect(html).toContain("Nothing to visualize yet")
  })

  it("shows the filtered-to-empty clear-filters affordance when filters exclude every page", () => {
    const bundle = bundleOf([page("wiki/papers/p1", fm("paper", "Paper One"))])
    const excludeEverything: VizFilters = { types: ["concept"], tags: [], yearRange: { min: null, max: null } }
    const html = renderToStaticMarkup(
      <VizWorkspace
        bundle={bundle}
        refsByPageId={null}
        citationFetchState="idle"
        onFetchCitations={NOOP}
        onRecompute={NOOP}
        busy={false}
        initialFilters={excludeEverything}
      />,
    )
    expect(html).toContain("No pages match these filters")
    expect(html).toContain("Clear filters")
  })

  // Task 10 regression: the toolbar (VizTabs/FilterBar/Recompute) must carry
  // the same `data-viz-canvas` marker as each lens's own canvas so Inspector's
  // click-away (Inspector.tsx) doesn't treat "click a lens tab to switch
  // lenses" as a click-away-to-deselect — otherwise a selection could never
  // survive switching lenses at all, defeating the point of sharing one
  // `selectedId` across the workspace. See Inspector.interaction.test.tsx for
  // the click-away mechanic itself (unchanged here, just a new exempt zone).
  it("marks the toolbar (VizTabs/FilterBar/Recompute row) with data-viz-canvas", () => {
    const bundle = bundleOf([page("wiki/papers/p1", fm("paper", "Paper One"))])
    const html = renderToStaticMarkup(
      <VizWorkspace
        bundle={bundle}
        refsByPageId={null}
        citationFetchState="idle"
        onFetchCitations={NOOP}
        onRecompute={NOOP}
        busy={false}
      />,
    )
    const toolbarStart = html.indexOf("data-viz-canvas")
    expect(toolbarStart).toBeGreaterThan(-1)
    // The marked toolbar div must be an ANCESTOR of the VizTabs "Timeline"
    // button, not some unrelated later element — a naive `toContain` check
    // for both substrings wouldn't catch the marker landing on the wrong
    // container.
    const timelineIdx = html.indexOf("Timeline")
    expect(timelineIdx).toBeGreaterThan(toolbarStart)
  })
})

describe("FilterBar", () => {
  it("renders type chips derived from filterOptions", () => {
    const bundle = bundleOf([
      page("wiki/papers/p1", fm("paper", "Paper One")),
      page("wiki/concepts/c1", fm("concept", "Concept One")),
    ])
    const options = filterOptions(bundle)
    const html = renderToStaticMarkup(<FilterBar options={options} filters={EMPTY_FILTERS} onChange={NOOP} />)
    expect(html).toContain("Paper")
    expect(html).toContain("Concept")
  })

  it("offers a 'query' type chip labeled 'Saved answer' (SP5 task 1: reinstated query type)", () => {
    const bundle = bundleOf([page("wiki/queries/q1", fm("query", "What causes X?"))])
    const options = filterOptions(bundle)
    const html = renderToStaticMarkup(<FilterBar options={options} filters={EMPTY_FILTERS} onChange={NOOP} />)
    expect(options.types).toContain("query")
    expect(html).toContain("Saved answer")
  })
})
