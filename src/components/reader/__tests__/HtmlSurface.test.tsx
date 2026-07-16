// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import HtmlSurface from "../HtmlSurface"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PAPER_HTML = "<h2>I Introduction</h2><p>Auditory Attention Decoding (AAD) in a cocktail party scenario.</p>"

/**
 * Regression guard for the reader's text-selection killer (2026-07-16):
 * React 19.2 re-applies `dangerouslySetInnerHTML` — destroying and
 * recreating every child node — whenever the wrapper OBJECT identity
 * changes across renders, even when the `__html` string is identical. An
 * inline `{{__html: …}}` literal therefore rebuilt the surface's DOM on
 * every parent re-render (which fires per selectionchange during a drag),
 * so the browser clamped the user's in-progress selection to the container
 * start and killed it on release. The wrapper must stay referentially
 * stable; this test re-renders the surface with unrelated parent state and
 * asserts the rendered DOM nodes SURVIVE.
 */

let roots: Array<{ root: Root; host: HTMLElement }> = []

function mount(el: React.ReactElement) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  roots.push({ root, host })
  return { host, rerender: (next: React.ReactElement) => act(() => root.render(next)) }
}

afterEach(() => {
  for (const { root } of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

function Harness({ onContainerReady }: { onContainerReady: (el: HTMLDivElement | null) => void }) {
  // Unrelated parent state — stands in for ReaderView's pendingSelection,
  // which updates on every selectionchange mid-drag.
  const [tick, setTick] = useState(0)
  return (
    <div data-tick={tick} onClick={() => setTick((t) => t + 1)}>
      <HtmlSurface
        html={PAPER_HTML}
        onPlainText={() => {}}
        onSelectionChange={() => {}}
        onContainerReady={onContainerReady}
      />
      <button type="button" onClick={() => setTick((t) => t + 1)}>
        tick
      </button>
    </div>
  )
}

describe("HtmlSurface", () => {
  it("keeps the same rendered DOM nodes across unrelated parent re-renders", () => {
    let container: HTMLDivElement | null = null
    const { host } = mount(<Harness onContainerReady={(el) => (container = el)} />)

    expect(container).not.toBeNull()
    const surface = container as unknown as HTMLDivElement
    // sanitize effect has run inside mount's act(); content is in the DOM.
    expect(surface.textContent).toContain("Auditory Attention Decoding")
    const paragraphBefore = surface.querySelector("p")
    expect(paragraphBefore).not.toBeNull()

    // Re-render the parent several times, as selectionchange does mid-drag.
    const button = host.querySelector("button")!
    for (let i = 0; i < 3; i++) {
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
    }

    // The DOM nodes must be the SAME objects — a live selection anchored in
    // them survives only if they were never destroyed.
    expect(surface.querySelector("p")).toBe(paragraphBefore)
    expect(surface.textContent).toContain("Auditory Attention Decoding")
  })
})
