// @vitest-environment jsdom
//
// Task 10: CitationFlowView gains optional selection wiring. Every node this
// view renders — on-canvas paper nodes AND the "no citation links" side-list
// entries — is a bundle paper page (deriveCitationFlow only ever produces
// edges between two vault papers; external/unresolved references never
// reach this component at all), so both are selectable.
import { describe, it, expect, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import CitationFlowView, { type CitationPaper } from "../CitationFlowView"
import type { CitationFlow } from "@/lib/viz/citations"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount(el: React.ReactElement): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  return { host, root }
}

function unmount(root: Root, host: HTMLDivElement) {
  act(() => root.unmount())
  host.remove()
}

const PAPERS: CitationPaper[] = [
  { id: "wiki/papers/p1", title: "Paper One", year: 2020 },
  { id: "wiki/papers/p2", title: "Paper Two", year: 2021 },
  { id: "wiki/papers/p3", title: "Paper Three", year: 2019 }, // no edges -> isolated list
]

const FLOW: CitationFlow = {
  edges: [{ citing: "wiki/papers/p1", cited: "wiki/papers/p2" }],
  papersWithData: 3,
  papersTotal: 3,
}

function renderFlow(props: Partial<React.ComponentProps<typeof CitationFlowView>> = {}) {
  return mount(
    <CitationFlowView papers={PAPERS} flow={FLOW} fetchState="done" onFetch={() => {}} {...props} />,
  )
}

describe("CitationFlowView selection", () => {
  it("renders a selected-state marker on the canvas node matching selectedId", () => {
    const { host, root } = renderFlow({ selectedId: "wiki/papers/p1", onSelect: () => {} })
    expect(host.querySelector('[data-selected="true"]')).toBeTruthy()
    unmount(root, host)
  })

  it("fires onSelect with the paper's page id when a canvas node is clicked", () => {
    const onSelect = vi.fn()
    const { host, root } = renderFlow({ onSelect })
    const circle = host.querySelector("circle")
    expect(circle, "at least one canvas node should render").toBeTruthy()
    act(() => {
      circle!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith("wiki/papers/p1")
    unmount(root, host)
  })

  it("fires onSelect with the paper's page id when an isolated-list entry is clicked", () => {
    const onSelect = vi.fn()
    const { host, root } = renderFlow({ onSelect })
    const isolatedButton = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Paper Three",
    )
    expect(isolatedButton, "isolated paper entry should render").toBeTruthy()
    act(() => {
      isolatedButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith("wiki/papers/p3")
    unmount(root, host)
  })

  it("renders identically for an unknown selectedId as for none", () => {
    // Normalize React's useId()-generated arrow-marker id — it increments
    // per mount (a test-harness artifact of rendering two instances in one
    // test, not something either render varies on its own) — before
    // comparing markup.
    const stripMarkerId = (html: string) => html.replace(/_r_\d+_-citation-arrow/g, "MARKER")
    const none = renderFlow({ onSelect: () => {} })
    const unknown = renderFlow({ selectedId: "wiki/papers/does-not-exist", onSelect: () => {} })
    expect(stripMarkerId(unknown.host.innerHTML)).toBe(stripMarkerId(none.host.innerHTML))
    unmount(none.root, none.host)
    unmount(unknown.root, unknown.host)
  })

  it("marks its root container with data-viz-canvas", () => {
    const { host, root } = renderFlow({ onSelect: () => {} })
    expect(host.querySelector("[data-viz-canvas]")).toBeTruthy()
    unmount(root, host)
  })
})
