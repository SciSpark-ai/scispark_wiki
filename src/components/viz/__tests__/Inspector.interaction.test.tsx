// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import Inspector from "../Inspector"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Regression coverage for the click-away review fixes: the graph canvas
// (GraphView's container, marked `[data-viz-canvas]`) is a flex SIBLING of
// Inspector, not an ancestor — so Inspector's click-away handler must
// special-case it rather than treating every canvas click as "outside".
// GraphView itself can't be mounted here (Sigma needs real WebGL, which
// jsdom doesn't provide), so this exercises Inspector's click-away logic
// directly against a synthetic `[data-viz-canvas]` sibling standing in for
// the real canvas element GraphView renders.

function fm(type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter {
  return { type, title, created: "2024-01-01", updated: "2024-01-01", tags: [], related: [], sources: [], ...extra }
}

function page(id: string, frontmatter: Frontmatter, body = ""): WikiPage {
  return { id, path: `${id}.md`, frontmatter, body }
}

function bundleOf(pages: WikiPage[]): Bundle {
  return { pages: new Map(pages.map((p) => [p.id, p])), links: [], errors: [] }
}

let roots: Root[] = []

function mount(el: React.ReactElement) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  roots.push(root)
  return { host, rerender: (next: React.ReactElement) => act(() => root.render(next)) }
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("Inspector click-away", () => {
  const bundle = bundleOf([page("wiki/concepts/a", fm("concept", "Concept A"))])

  it("does NOT close when the mousedown target is inside a [data-viz-canvas] sibling", () => {
    const onClose = vi.fn()
    // A synthetic canvas sibling, standing in for GraphView's real
    // `data-viz-canvas` container — asserts against the *marker contract*,
    // not against Sigma internals.
    const canvas = document.createElement("div")
    canvas.setAttribute("data-viz-canvas", "")
    const canvasNode = document.createElement("span")
    canvas.appendChild(canvasNode)
    document.body.appendChild(canvas)

    mount(<Inspector bundle={bundle} id="wiki/concepts/a" neighbors={[]} onSelect={vi.fn()} onClose={onClose} />)

    act(() => {
      canvasNode.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it("DOES close when the mousedown target is outside both the panel and the canvas", () => {
    const onClose = vi.fn()
    const chrome = document.createElement("button")
    document.body.appendChild(chrome)

    mount(<Inspector bundle={bundle} id="wiki/concepts/a" neighbors={[]} onSelect={vi.fn()} onClose={onClose} />)

    act(() => {
      chrome.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes on Escape", () => {
    const onClose = vi.fn()
    mount(<Inspector bundle={bundle} id="wiki/concepts/a" neighbors={[]} onSelect={vi.fn()} onClose={onClose} />)

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does not resubscribe its document listeners across re-renders when onClose is referentially stable", () => {
    const onClose = vi.fn()
    const addSpy = vi.spyOn(document, "addEventListener")

    const { rerender } = mount(
      <Inspector bundle={bundle} id="wiki/concepts/a" neighbors={[]} onSelect={vi.fn()} onClose={onClose} />,
    )
    const callsAfterMount = addSpy.mock.calls.filter((c) => c[0] === "mousedown").length
    expect(callsAfterMount).toBe(1)

    // Re-render with the SAME onClose reference (as VizWorkspace's
    // useCallback-memoized `closeInspector` now guarantees) — the effect's
    // `[onClose]` dependency should skip re-running entirely.
    rerender(<Inspector bundle={bundle} id="wiki/concepts/a" neighbors={["wiki/concepts/a"]} onSelect={vi.fn()} onClose={onClose} />)

    const callsAfterRerender = addSpy.mock.calls.filter((c) => c[0] === "mousedown").length
    expect(callsAfterRerender).toBe(callsAfterMount)
  })
})
