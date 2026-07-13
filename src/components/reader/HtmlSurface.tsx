"use client"

import { useCallback, useEffect, useRef } from "react"
import { sanitizePaperHtml } from "@/lib/reader/sanitize"
import { plainTextOf, rangeToOffsets } from "@/lib/reader/dom-offsets"

/** A completed, non-collapsed text selection inside a reading surface,
 * expressed in the same flat plain-text offset space the anchor core
 * (`src/lib/highlights/anchor.ts`) and `HighlightLayer` use — the contract
 * shared with `PdfSurface`'s `onSelect`. `rectTop`/`rectLeft` are viewport
 * coordinates (from `getBoundingClientRect`), the same coordinate space
 * `position: fixed` uses, so `SelectionBubble` can place itself directly
 * from them without any extra conversion. */
export interface SurfaceSelection {
  start: number
  end: number
  text: string
  rectTop: number
  rectLeft: number
}

export interface HtmlSurfaceProps {
  /** Untrusted paper HTML (arXiv/PMC full text) — sanitized here via
   * `sanitizePaperHtml` before render; never passed through as-is. */
  html: string
  /** Emitted after every render that changes the sanitized content, with
   * the surface's flattened plain text (`plainTextOf(container)`), so
   * highlights anchor against the same text this surface actually
   * displays. */
  onPlainText: (text: string) => void
  /** Called with the current selection whenever the user completes a
   * non-collapsed selection inside the surface, or `null` when the
   * selection is dismissed/collapsed (including an externally-triggered
   * collapse, e.g. `SelectionBubble`'s outside-click/scroll dismissal —
   * see the `selectionchange` listener below). */
  onSelectionChange: (selection: SurfaceSelection | null) => void
  /** Called once the container element mounts (and again with `null` on
   * unmount), so a parent can hand the live node to `HighlightLayer` as
   * its `surfaceRoot` — `offsetsToRange`/highlight painting need the same
   * DOM tree this component renders into, not a copy. */
  onContainerReady?: (container: HTMLDivElement | null) => void
}

/**
 * Renders sanitized paper HTML as the in-app reading surface, and bridges
 * native browser text selection into the anchor-core's offset space via
 * `rangeToOffsets` so `SelectionBubble`/highlighting work identically to
 * `PdfSurface`'s text-layer selection.
 *
 * Highlight painting itself is not this component's job — a parent renders
 * `HighlightLayer` as an absolutely-positioned sibling (same convention
 * `PdfSurface` uses for its own `.highlightOverlay`), using the container
 * handed back via `onContainerReady` as `surfaceRoot`.
 */
export default function HtmlSurface({ html, onPlainText, onSelectionChange, onContainerReady }: HtmlSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Callback props are read from refs so a new function identity on every
  // parent render doesn't force effects below to re-run unnecessarily.
  const onPlainTextRef = useRef(onPlainText)
  const onSelectionChangeRef = useRef(onSelectionChange)
  useEffect(() => {
    onPlainTextRef.current = onPlainText
  }, [onPlainText])
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const sanitizedHtml = sanitizePaperHtml(html)

  // Emit the surface's flattened plain text after every render that changes
  // the sanitized content, so callers (highlight anchoring) always work
  // against exactly what's on screen. Also hands the container node up once
  // on mount (and clears it on unmount) so a parent can wire HighlightLayer.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    onPlainTextRef.current(plainTextOf(container))
    // sanitizedHtml (not html) is the actual DOM content driving this
    // effect; onPlainTextRef is a ref (stable identity, doesn't need to be
    // a dependency).
  }, [sanitizedHtml])

  useEffect(() => {
    onContainerReady?.(containerRef.current)
    return () => onContainerReady?.(null)
    // Runs once on mount/unmount only — the container node's identity never
    // changes across re-renders (React reuses the same DOM element).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelection = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      onSelectionChangeRef.current(null)
      return
    }

    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) {
      // A selection elsewhere on the page (or one that already left this
      // surface) isn't ours to report — but don't clear the caller's state
      // on its behalf either, since it may belong to another surface.
      return
    }

    const offsets = rangeToOffsets(container, range)
    if (!offsets) {
      onSelectionChangeRef.current(null)
      return
    }

    const rect = range.getBoundingClientRect()
    const surfaceText = plainTextOf(container)
    onSelectionChangeRef.current({
      start: offsets.start,
      end: offsets.end,
      text: surfaceText.slice(offsets.start, offsets.end),
      rectTop: rect.top,
      rectLeft: rect.left,
    })
  }, [])

  // selectionchange fires for every selection mutation anywhere in the
  // document, including a programmatic collapse triggered from outside this
  // component (SelectionBubble's outside-click/scroll dismissal calls
  // `window.getSelection()?.removeAllRanges()` rather than owning a
  // dedicated onDismiss prop — see SelectionBubble's doc comment). Listening
  // here is what turns that collapse into onSelectionChange(null) for the
  // parent that owns the selection state.
  useEffect(() => {
    document.addEventListener("selectionchange", handleSelection)
    return () => document.removeEventListener("selectionchange", handleSelection)
  }, [handleSelection])

  return (
    <div
      ref={containerRef}
      className="reader-surface font-body text-[15px]/[26px] text-espresso max-w-[68ch]"
      // Content is sanitized via sanitizePaperHtml immediately above — see
      // that module's doc comment for the allowlist/hook this relies on.
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      onMouseUp={handleSelection}
      onKeyUp={handleSelection}
    />
  )
}
