"use client"

import { useEffect, useMemo, useState } from "react"
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
 */
export default function HighlightLayer({ surfaceRoot, surfaceText, highlights, onClickHighlight }: HighlightLayerProps) {
  // getClientRects()/getBoundingClientRect() depend on layout, which can
  // shift for reasons this component has no other way to observe (window
  // resize, font load, content reflow). recomputeTick forces a recompute
  // without needing every such reason wired in individually.
  const [recomputeTick, setRecomputeTick] = useState(0)

  useEffect(() => {
    function scheduleRecompute() {
      setRecomputeTick((tick) => tick + 1)
    }
    window.addEventListener("resize", scheduleRecompute)
    window.addEventListener("scroll", scheduleRecompute, true)
    return () => {
      window.removeEventListener("resize", scheduleRecompute)
      window.removeEventListener("scroll", scheduleRecompute, true)
    }
  }, [])

  const { rects, orphanedCount } = useMemo(() => {
    if (!surfaceRoot) return { rects: [] as PaintedRect[], orphanedCount: 0 }

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

    return { rects: painted, orphanedCount: orphaned }
    // recomputeTick is a deliberate extra dependency: it never changes the
    // values above by itself, only forces this memo to re-run when layout
    // may have shifted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceRoot, surfaceText, highlights, recomputeTick])

  if (!surfaceRoot) return null

  return (
    <div className="pointer-events-none absolute inset-0">
      {rects.map((rect, i) => (
        <span
          key={`${rect.highlightId}-${i}`}
          role="button"
          tabIndex={0}
          onClick={() => onClickHighlight(rect.highlightId)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onClickHighlight(rect.highlightId)
          }}
          className="pointer-events-auto absolute cursor-pointer rounded-[2px]"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            backgroundColor: rect.color,
          }}
        />
      ))}
      {orphanedCount > 0 && (
        <div className="pointer-events-auto absolute top-2 right-2 rounded-pill border border-border-warm bg-light-surface px-2.5 py-1 text-[11px] text-muted-text shadow-sm">
          {orphanedCount} highlight{orphanedCount === 1 ? "" : "s"} no longer match the text
        </div>
      )}
    </div>
  )
}
