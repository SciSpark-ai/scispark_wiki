// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import HighlightLayer from "../HighlightLayer"
import { createAnchor } from "@/lib/highlights/anchor"
import type { Highlight } from "@/lib/highlights/types"

// React's act() requires this flag outside of test renderers.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * jsdom does no layout: Range.getClientRects()/getBoundingClientRect() have
 * no real geometry. These stubs simulate the one thing the component needs
 * from layout — "does the surface have geometry yet, and where is the
 * highlighted range" — via a module-level `layoutReady` switch, so tests can
 * reproduce the reload race where highlights + text are ready BEFORE the
 * surface has been laid out (the state a real browser is in during initial
 * load, font swap, or a zero-size container).
 */
let layoutReady = true
const RANGE_RECT = { left: 40, top: 100, width: 200, height: 20, right: 240, bottom: 120, x: 40, y: 100 }

/** Captures ResizeObserver instances so tests can fire the "surface geometry
 * changed" signal the way a real browser would after layout/reflow. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: Element[] = []
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function fireAllResizeObservers() {
  expect(FakeResizeObserver.instances.length).toBeGreaterThan(0)
  act(() => {
    for (const ro of FakeResizeObserver.instances) ro.fire()
  })
}

/** One paper-like surface: a paragraph containing the passage we highlight. */
const PASSAGE = "In a cocktail party scenario where multiple speakers are talking simultaneously"
function buildSurface(): HTMLDivElement {
  const container = document.createElement("div")
  container.innerHTML = `<h2>I Introduction</h2><p>${PASSAGE} [cherry1953some], listeners attend selectively.</p>`
  document.body.appendChild(container)
  return container
}

function highlightFor(surfaceText: string): Highlight {
  const start = surfaceText.indexOf(PASSAGE)
  expect(start).toBeGreaterThanOrEqual(0)
  return {
    id: "h_test_1",
    anchor: createAnchor(surfaceText, start, start + PASSAGE.length),
    color: "yellow",
    note: "",
    createdTs: "2026-07-15T00:00:00.000Z",
  }
}

interface Mounted {
  host: HTMLDivElement
  root: Root
  rerender: (el: React.ReactElement) => void
}

let mounted: Mounted[] = []

function mount(el: React.ReactElement): Mounted {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  const m: Mounted = { host, root, rerender: (next) => act(() => root.render(next)) }
  mounted.push(m)
  return m
}

function paintedSpans(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll('span[role="button"]'))
}

beforeEach(() => {
  layoutReady = true
  FakeResizeObserver.instances = []
  vi.stubGlobal("ResizeObserver", FakeResizeObserver)
  // Simulated layout: a laid-out range has one rect; a not-yet-laid-out
  // surface yields none (exactly what a browser reports pre-layout).
  Range.prototype.getClientRects = function getClientRects() {
    const rects = layoutReady ? [RANGE_RECT] : []
    return Object.assign(rects, { item: (i: number) => rects[i] ?? null }) as unknown as DOMRectList
  }
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { left: 10, top: 20, width: 600, height: 800, right: 610, bottom: 820, x: 10, y: 20, toJSON: () => ({}) } as DOMRect
  }
})

afterEach(() => {
  for (const m of mounted) act(() => m.root.unmount())
  mounted = []
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("HighlightLayer", () => {
  it("paints a persisted highlight when container, text, and highlights are all present (reload repro)", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)

    const { host } = mount(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[h]} onClickHighlight={() => {}} />,
    )

    const spans = paintedSpans(host)
    expect(spans.length).toBe(1)
    // Positioned relative to the surface root's box (rect 40,100 minus root 10,20).
    expect(spans[0].style.left).toBe("30px")
    expect(spans[0].style.top).toBe("80px")
    expect(spans[0].style.backgroundColor).toBe("rgba(250, 204, 21, 0.38)")
    // Not orphaned: no "no longer match" affordance.
    expect(host.textContent).not.toContain("no longer match")
  })

  it("paints when highlights arrive after the surface is ready (late fetch)", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)

    const { host, rerender } = mount(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[]} onClickHighlight={() => {}} />,
    )
    expect(paintedSpans(host).length).toBe(0)

    rerender(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[h]} onClickHighlight={() => {}} />,
    )
    expect(paintedSpans(host).length).toBe(1)
  })

  it("paints when surface text and root arrive after highlights (late surface)", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)

    // Highlights loaded first — surface still mounting (root null, text empty).
    const { host, rerender } = mount(
      <HighlightLayer surfaceRoot={null} surfaceText="" highlights={[h]} onClickHighlight={() => {}} />,
    )
    expect(paintedSpans(host).length).toBe(0)

    rerender(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[h]} onClickHighlight={() => {}} />,
    )
    expect(paintedSpans(host).length).toBe(1)
  })

  it("paints once the surface gains geometry after mount (late layout — reload race)", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)

    // All three inputs present, but the surface hasn't been laid out yet —
    // the browser reports no client rects (initial load / zero-size pane /
    // pre-font-swap). This is the state a reload paints nothing from.
    layoutReady = false
    const { host } = mount(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[h]} onClickHighlight={() => {}} />,
    )
    expect(paintedSpans(host).length).toBe(0)

    // Layout completes; the browser announces it via ResizeObserver.
    layoutReady = true
    fireAllResizeObservers()
    expect(paintedSpans(host).length).toBe(1)
  })

  it("recomputes positions on window resize", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)

    layoutReady = false
    const { host } = mount(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[h]} onClickHighlight={() => {}} />,
    )
    expect(paintedSpans(host).length).toBe(0)

    layoutReady = true
    act(() => {
      window.dispatchEvent(new Event("resize"))
    })
    expect(paintedSpans(host).length).toBe(1)
  })

  it("paints spans that cannot intercept the mouse (text selection must pass through)", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)

    const { host } = mount(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[h]} onClickHighlight={() => {}} />,
    )
    const spans = paintedSpans(host)
    expect(spans.length).toBe(1)
    // pointer-events none: a mousedown over the highlight must hit the TEXT
    // underneath, not this empty span (which sits after the whole article in
    // DOM order and wrecks selection anchoring — the "selects everything
    // before the cursor" bug).
    expect(spans[0].className).toContain("pointer-events-none")
    expect(spans[0].className).not.toContain("pointer-events-auto")
  })

  it("still removes a highlight on a plain click over it (hit-test on the surface)", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)
    const clicked: string[] = []

    mount(
      <HighlightLayer
        surfaceRoot={surface}
        surfaceText={surfaceText}
        highlights={[h]}
        onClickHighlight={(id) => clicked.push(id)}
      />,
    )

    // RANGE_RECT is at viewport (40..240, 100..120): click inside it.
    act(() => {
      surface.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 110, bubbles: true }))
    })
    expect(clicked).toEqual([h.id])

    // A click outside every painted rect does nothing.
    act(() => {
      surface.dispatchEvent(new MouseEvent("click", { clientX: 500, clientY: 400, bubbles: true }))
    })
    expect(clicked).toEqual([h.id])
  })

  it("does not remove a highlight when the click ends a text selection", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const h = highlightFor(surfaceText)
    const clicked: string[] = []

    mount(
      <HighlightLayer
        surfaceRoot={surface}
        surfaceText={surfaceText}
        highlights={[h]}
        onClickHighlight={(id) => clicked.push(id)}
      />,
    )

    // Simulate the end of a drag-selection: a live, non-collapsed selection
    // exists when the click event fires.
    const textNode = surface.querySelector("p")!.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 10)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    act(() => {
      surface.dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 110, bubbles: true }))
    })
    expect(clicked).toEqual([])
    sel.removeAllRanges()
  })

  it("surfaces an orphaned highlight as a count instead of dropping it silently", () => {
    const surface = buildSurface()
    const surfaceText = surface.textContent ?? ""
    const orphan: Highlight = {
      id: "h_orphan",
      anchor: { exact: "text that no longer exists anywhere", prefix: "", suffix: "", start: 0, end: 35 },
      color: "yellow",
      note: "",
      createdTs: "2026-07-15T00:00:00.000Z",
    }

    const { host } = mount(
      <HighlightLayer surfaceRoot={surface} surfaceText={surfaceText} highlights={[orphan]} onClickHighlight={() => {}} />,
    )
    expect(paintedSpans(host).length).toBe(0)
    expect(host.textContent).toContain("1 highlight no longer match")
  })
})
