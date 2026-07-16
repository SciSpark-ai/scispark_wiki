"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Highlight } from "@/lib/highlights/types"
import { resolveAnchor } from "@/lib/highlights/anchor"
import { offsetsToRange } from "@/lib/reader/dom-offsets"

export interface HighlightLayerProps {
  /** The live container the highlighted text actually lives in — either
   * `HtmlSurface`'s container (handed back via its `onContainerReady`) or
   * `PdfSurface`'s rendered text-layer container. Painting is a no-op
   * while this is `null` (surface not mounted yet). */
  surfaceRoot: HTMLElement | null
  /** The exact plain text `surfaceRoot` currently renders — must be the
   * same string the surface emitted via `onPlainText`, since every
   * highlight's anchor is resolved against it. */
  surfaceText: string
  highlights: Highlight[]
  onClickHighlight: (id: string) => void
}

interface PaintedRect {
  highlightId: string
  color: string
  left: number
  top: number
  width: number
  height: number
}

interface PaintState {
  rects: PaintedRect[]
  orphanedCount: number
}

const EMPTY_PAINT: PaintState = { rects: [], orphanedCount: 0 }

/** Fixed palette for `Highlight.color` — see the field's doc comment in
 * `src/lib/highlights/types.ts`. Unknown/legacy color values fall back to
 * yellow rather than rendering an invisible highlight. */
const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "rgba(250, 204, 21, 0.38)",
  orange: "rgba(249, 115, 22, 0.32)",
  green: "rgba(74, 222, 128, 0.32)",
  blue: "rgba(96, 165, 250, 0.32)",
  pink: "rgba(244, 114, 182, 0.32)",
}
const DEFAULT_COLOR = HIGHLIGHT_COLORS.yellow

function colorFor(color: string): string {
  return HIGHLIGHT_COLORS[color] ?? DEFAULT_COLOR
}

/** Structural equality for paint states, so geometry-driven recomputes that
 * change nothing (scroll, no-op ResizeObserver ticks) bail out instead of
 * re-rendering the overlay. */
function paintEquals(a: PaintState, b: PaintState): boolean {
  if (a.orphanedCount !== b.orphanedCount || a.rects.length !== b.rects.length) return false
  for (let i = 0; i < a.rects.length; i++) {
    const ra = a.rects[i]
    const rb = b.rects[i]
    if (
      ra.highlightId !== rb.highlightId ||
      ra.color !== rb.color ||
      ra.left !== rb.left ||
      ra.top !== rb.top ||
      ra.width !== rb.width ||
      ra.height !== rb.height
    ) {
      return false
    }
  }
  return true
}

/**
 * Paints persisted highlights over a reading surface as absolutely
 * positioned rects, and surfaces (rather than silently drops) any
 * highlight whose anchor no longer resolves against the surface's current
 * text.
 *
 * Renders as an overlay meant to sit directly above `surfaceRoot`'s own box
 * — the caller renders this as a sibling of the surface inside a shared
 * `position: relative` wrapper sized to the surface (the same convention
 * `PdfSurface`'s own `.highlightOverlay` uses), since rects are computed
 * relative to `surfaceRoot.getBoundingClientRect()`.
 *
 * Resolution, per highlight: `resolveAnchor(surfaceText, h.anchor)` first;
 * on success, `offsetsToRange(surfaceRoot, start, end)` turns those offsets
 * into a live Range, and `range.getClientRects()` (plural — a highlight
 * that wraps across lines yields multiple boxes) becomes the painted rects.
 * Either step failing — anchor unresolved, or (defensively) a Range that
 * still can't be built — marks the highlight orphaned; orphaned highlights
 * are counted and surfaced via a small non-blocking affordance instead of
 * vanishing, so the user isn't left wondering where a highlight went.
 *
 * Measurement runs in effects (never during render), and re-runs whenever
 * ANY of the three inputs becomes ready — container, text, highlights — in
 * any arrival order, plus whenever the surface's geometry changes for
 * reasons React can't see: a `ResizeObserver` on `surfaceRoot` (initial
 * layout, image/figure loads, container resize — including a surface that
 * first laid out at zero size), `document.fonts.ready` (a webfont swap
 * reflows every line box without necessarily firing a resize), and window
 * resize/scroll. Without the observer, rects computed before the surface
 * had real geometry stayed empty or mis-placed until a lucky window event —
 * the "highlights don't re-paint after reload" bug.
 */
export default function HighlightLayer({ surfaceRoot, surfaceText, highlights, onClickHighlight }: HighlightLayerProps) {
  const [paint, setPaint] = useState<PaintState>(EMPTY_PAINT)

  // Read by the surface-level click hit-test below without re-subscribing
  // the listener on every paint/render (mirrors HtmlSurface's callback-ref
  // idiom).
  const paintRef = useRef(paint)
  useEffect(() => {
    paintRef.current = paint
  }, [paint])
  const onClickHighlightRef = useRef(onClickHighlight)
  useEffect(() => {
    onClickHighlightRef.current = onClickHighlight
  }, [onClickHighlight])

  const recompute = useCallback(() => {
    if (!surfaceRoot) {
      setPaint((prev) => (paintEquals(prev, EMPTY_PAINT) ? prev : EMPTY_PAINT))
      return
    }

    const rootRect = surfaceRoot.getBoundingClientRect()
    const painted: PaintedRect[] = []
    let orphaned = 0

    for (const highlight of highlights) {
      const resolved = resolveAnchor(surfaceText, highlight.anchor)
      if (!resolved) {
        orphaned += 1
        continue
      }

      const range = offsetsToRange(surfaceRoot, resolved.start, resolved.end)
      if (!range) {
        // Anchor resolved against surfaceText but the live DOM couldn't
        // build a matching Range (e.g. surfaceRoot hasn't caught up with
        // surfaceText yet) — treat as orphaned rather than crash.
        orphaned += 1
        continue
      }

      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width === 0 && rect.height === 0) continue
        painted.push({
          highlightId: highlight.id,
          color: colorFor(highlight.color),
          left: rect.left - rootRect.left,
          top: rect.top - rootRect.top,
          width: rect.width,
          height: rect.height,
        })
      }
    }

    const next: PaintState = { rects: painted, orphanedCount: orphaned }
    setPaint((prev) => (paintEquals(prev, next) ? prev : next))
  }, [surfaceRoot, surfaceText, highlights])

  // Re-measure after every commit that changes an input — before the browser
  // paints, so highlights never flash out for a frame on text/highlight
  // updates. (This component never renders during SSR: the reader page only
  // mounts it client-side once its own loading state resolves.)
  useLayoutEffect(() => {
    // Deliberate measure-then-set: DOM geometry can only be read after
    // commit, and useLayoutEffect + setState is React's own documented
    // pattern for it ("Measuring layout before the browser repaints").
    // The paintEquals bail in recompute keeps this from cascading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recompute()
  }, [recompute])

  // The surface's own geometry arriving/changing is invisible to React —
  // observe it directly. ResizeObserver fires once on observe() (covering
  // "layout became available after we first measured") and again on any
  // content-driven reflow (figures/images loading, font swap changing
  // heights, pane resize).
  useEffect(() => {
    if (!surfaceRoot || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => recompute())
    observer.observe(surfaceRoot)
    return () => observer.disconnect()
  }, [surfaceRoot, recompute])

  // Font swaps reflow line boxes; re-measure once all fonts settle.
  useEffect(() => {
    let cancelled = false
    document.fonts?.ready?.then(() => {
      if (!cancelled) recompute()
    })
    return () => {
      cancelled = true
    }
  }, [recompute])

  // Mouse interaction happens on the SURFACE, not on the painted spans: the
  // spans are pointer-events-none so that starting a text selection over
  // highlighted text anchors in the text itself. (The spans are empty
  // elements that sit after the whole article in DOM order — letting them
  // take the mousedown made the browser anchor the selection at the
  // overlay's document position, selecting half the article; and releasing
  // over one could silently delete the highlight.) A plain click — never the
  // end of a drag-selection, hence the collapsed-selection guard — that
  // lands inside a painted rect still removes that highlight.
  useEffect(() => {
    if (!surfaceRoot) return
    function handleSurfaceClick(event: MouseEvent) {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      const rootRect = surfaceRoot!.getBoundingClientRect()
      const x = event.clientX - rootRect.left
      const y = event.clientY - rootRect.top
      for (const rect of paintRef.current.rects) {
        if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) {
          onClickHighlightRef.current(rect.highlightId)
          return
        }
      }
    }
    surfaceRoot.addEventListener("click", handleSurfaceClick)
    return () => surfaceRoot.removeEventListener("click", handleSurfaceClick)
  }, [surfaceRoot])

  // Window-level layout shifts (viewport resize; scroll listens in capture
  // so inner-scroller surfaces that reflow on scroll are covered too).
  useEffect(() => {
    window.addEventListener("resize", recompute)
    window.addEventListener("scroll", recompute, true)
    return () => {
      window.removeEventListener("resize", recompute)
      window.removeEventListener("scroll", recompute, true)
    }
  }, [recompute])

  if (!surfaceRoot) return null

  return (
    <div className="pointer-events-none absolute inset-0">
      {paint.rects.map((rect, i) => (
        <span
          key={`${rect.highlightId}-${i}`}
          role="button"
          tabIndex={0}
          onClick={() => onClickHighlight(rect.highlightId)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onClickHighlight(rect.highlightId)
          }}
          className="pointer-events-none absolute rounded-[2px]"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            backgroundColor: rect.color,
          }}
        />
      ))}
      {paint.orphanedCount > 0 && (
        <div className="pointer-events-auto absolute top-2 right-2 rounded-pill border border-border-warm bg-light-surface px-2.5 py-1 text-[11px] text-muted-text shadow-sm">
          {paint.orphanedCount} highlight{paint.orphanedCount === 1 ? "" : "s"} no longer match the text
        </div>
      )}
    </div>
  )
}
