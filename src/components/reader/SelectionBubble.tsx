"use client"

import { useEffect, useRef, type CSSProperties } from "react"
import type { SurfaceSelection } from "./HtmlSurface"

export interface SelectionBubbleProps {
  selection: SurfaceSelection | null
  onAsk: () => void
  /** Omit to hide the Highlight action entirely — used by callers (e.g. a
   * future paper page via `AskableSurface`'s `enableHighlight`) that don't
   * support persistent highlighting on this surface. */
  onHighlight?: () => void
  onCapture: () => void
}

const VERTICAL_GAP = 10
const MIN_EDGE_MARGIN = 8

/**
 * Floating bubble anchored to the current text selection, offering the
 * three select-to-ask actions (Ask / Highlight / Capture idea). Shared
 * across the HTML and PDF reading surfaces — both hand it the same
 * `SurfaceSelection` shape.
 *
 * There is deliberately no `onDismiss` prop: this component dismisses
 * itself on outside-click or scroll by collapsing the *native* browser
 * selection (`window.getSelection()?.removeAllRanges()`) rather than
 * calling back into the parent directly. `HtmlSurface`/`PdfSurface` both
 * treat a collapsed selection as `onSelectionChange(null)` /
 * `onSelect`-silence, so the parent's `selection` state (and therefore this
 * bubble) clears itself through the same path a real deselection would.
 * This keeps the bubble's "am I still showing a live selection?" state in
 * one place — the actual DOM selection — instead of two.
 */
export default function SelectionBubble({ selection, onAsk, onHighlight, onCapture }: SelectionBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!selection) return

    function dismiss() {
      window.getSelection()?.removeAllRanges()
    }

    function handlePointerDown(event: MouseEvent) {
      if (bubbleRef.current && event.target instanceof Node && bubbleRef.current.contains(event.target)) {
        return
      }
      dismiss()
    }

    function handleScroll() {
      dismiss()
    }

    // Outside click: mousedown (not click) so the bubble's own buttons still
    // receive their click before any dismissal logic could interfere.
    document.addEventListener("mousedown", handlePointerDown)
    // Scroll listener in the capture phase: scrolling inside a nested
    // scrollable reader pane doesn't bubble a "scroll" event up to
    // `window`, only capture-phase listeners see it.
    window.addEventListener("scroll", handleScroll, true)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [selection])

  if (!selection) return null

  const style: CSSProperties = {
    position: "fixed",
    top: Math.max(MIN_EDGE_MARGIN, selection.rectTop - VERTICAL_GAP),
    left: Math.max(MIN_EDGE_MARGIN, selection.rectLeft),
    transform: "translateY(-100%)",
    zIndex: 50,
  }

  return (
    <div
      ref={bubbleRef}
      role="toolbar"
      aria-label="Selection actions"
      style={style}
      className="flex items-center gap-1 rounded-pill border border-border-warm bg-espresso px-1.5 py-1 shadow-lg"
    >
      <button
        type="button"
        onClick={onAsk}
        className="text-[12px] font-medium tracking-body text-white px-2.5 py-1 rounded-pill hover:bg-white/10 transition-colors"
      >
        Ask
      </button>
      {onHighlight && (
        <button
          type="button"
          onClick={onHighlight}
          className="text-[12px] font-medium tracking-body text-white px-2.5 py-1 rounded-pill hover:bg-white/10 transition-colors"
        >
          Highlight
        </button>
      )}
      <button
        type="button"
        onClick={onCapture}
        className="text-[12px] font-medium tracking-body text-orange-light px-2.5 py-1 rounded-pill hover:bg-white/10 transition-colors"
      >
        Capture idea
      </button>
    </div>
  )
}
