"use client"

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react"
import type { SurfaceSelection } from "./HtmlSurface"

export interface SelectionBubbleProps {
  selection: SurfaceSelection | null
  onAsk: () => void
  /** Omit to hide the Highlight action entirely — used by callers (e.g. a
   * future paper page via `AskableSurface`'s `enableHighlight`) that don't
   * support persistent highlighting on this surface. */
  onHighlight?: () => void
  onCapture: () => void
  onSaveToNote?: () => void
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
export default function SelectionBubble({ selection, onAsk, onHighlight, onCapture, onSaveToNote }: SelectionBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!selection || !bubble) return
    const rect = bubble.getBoundingClientRect()
    bubble.style.left = `${Math.max(MIN_EDGE_MARGIN, Math.min(selection.rectLeft, window.innerWidth - rect.width - MIN_EDGE_MARGIN))}px`
    bubble.style.top = `${Math.max(MIN_EDGE_MARGIN, selection.rectTop - rect.height - VERTICAL_GAP)}px`
  }, [selection])

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
    zIndex: 50,
  }

  return (
    <div
      ref={bubbleRef}
      role="toolbar"
      aria-label="Selection actions"
      data-selection-bubble
      style={style}
      className="flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-1 rounded-pill border border-border-warm bg-light-surface px-1.5 py-1 shadow-lg [&>button]:whitespace-nowrap"
    >
      <button
        type="button"
        onClick={onAsk}
        className="text-[12px] font-medium tracking-body text-espresso px-2.5 py-1 rounded-pill hover:bg-card-surface transition-colors"
      >
        Ask
      </button>
      {onHighlight && (
        <button
          type="button"
          onClick={onHighlight}
          className="text-[12px] font-medium tracking-body text-espresso px-2.5 py-1 rounded-pill hover:bg-card-surface transition-colors"
        >
          Highlight
        </button>
      )}
      <button
        type="button"
        onClick={onCapture}
        className="text-[12px] font-medium tracking-body text-accent-ink-hover px-2.5 py-1 rounded-pill hover:bg-card-surface transition-colors"
      >
        Capture idea
      </button>
      {onSaveToNote && (
        <button type="button" onClick={onSaveToNote} className="text-[12px] font-medium tracking-body text-espresso px-2.5 py-1 rounded-pill hover:bg-card-surface transition-colors whitespace-nowrap">
          Save to note
        </button>
      )}
    </div>
  )
}
