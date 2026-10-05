"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { SurfaceSelection } from "./HtmlSurface"
import SelectionBubble from "./SelectionBubble"
import CaptureIdeaCard from "./CaptureIdeaCard"
import { paperKey, type PaperRecord } from "@/lib/papers/types"
import type { VaultStorage } from "@/lib/vault/storage"
import { captureIdeaAsNote } from "@/lib/reader/capture-idea"
import { askSparkyAboutSelection } from "@/components/companion/selection-request"
import { paperSlug } from "@/lib/wiki/authoring"
import { applyChangesetRemote } from "@/lib/vault/changeset-client"
import { wikiHref } from "@/lib/wiki/href"
import { openSelectionNote } from "@/components/notes/selection-note-request"

/** How much plain text on each side of a selection is sent as "surrounding"
 * context to Sparky (already truncated here, per
 * the chat request limits). */
const SURROUND_RADIUS = 800

function computeSurroundingText(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SURROUND_RADIUS)
  const to = Math.min(text.length, end + SURROUND_RADIUS)
  return text.slice(from, to)
}

export interface AskableSurfaceRenderProps {
  /** The current in-progress selection inside the wrapped content, or `null`
   * when nothing is selected. */
  pendingSelection: SurfaceSelection | null
  /** Wire directly onto an `HtmlSurface`'s `onSelectionChange`. */
  onHtmlSelectionChange: (selection: SurfaceSelection | null) => void
  /** Wire directly onto a `PdfSurface`'s `onSelect`. */
  onPdfSelect: (start: number, end: number, selectedText: string) => void

}

export interface AskableSurfaceProps {
  storage: VaultStorage
  paper: PaperRecord
  /** This paper's own wiki page id, if it has been ingested — threaded
   * through to `captureIdeaAsNote` for its `related[]` link. Best-effort;
   * omit if unknown. */
  sourcePageId?: string
  /** The wrapped content's current flattened plain text, in the same offset
   * space selections are reported in (`HtmlSurface`/`PdfSurface`'s own
   * `onPlainText`) — used to build the "surrounding text" sent to the
   * Reading-Companion skill. */
  surfaceText: string
  /** Show the selection bubble's Highlight action and forward its clicks via
   * `onHighlight`. This surface never persists highlights itself (no
   * `HighlightLayer` here) — off by default so a bare mount never shows a
   * non-functional button. */
  enableHighlight?: boolean
  /** Invoked with the snapshotted selection when the user clicks Highlight
   * (only reachable when `enableHighlight` is set — see above). The native
   * and internal selection are already cleared by the time this fires. */
  onHighlight?: (selection: SurfaceSelection) => void
  enableSaveToNote?: boolean
  /** Renders the wrapped content region. Receives this surface's selection
   * handlers back so the caller can wire them onto whichever reading
   * surface it mounts (`HtmlSurface`/`PdfSurface` today). A function rather
   * than a plain node because the content needs those handlers to report
   * selection changes back into this surface. */
  children: (renderProps: AskableSurfaceRenderProps) => ReactNode
}

/**
 * Extracted from `ReaderView` (Task 7, behavior-preserving): owns the
 * select→ask and select→capture-idea flows shared by any surface that
 * renders paper content — the in-app reader today, the SP2 paper page next.
 * Tracks the live selection over its wrapped `children`, shows
 * `SelectionBubble` for a non-empty one, hands questions to Sparky, and owns
 * the inline `CaptureIdeaCard` flow.
 *
 * Persistent highlights are explicitly NOT this surface's concern — it never
 * renders a `HighlightLayer` and never touches highlight storage. A caller
 * that also offers highlighting (`ReaderView`) opts the bubble's Highlight
 * action in via `enableHighlight` + `onHighlight` and keeps its own
 * highlight state/handlers entirely outside this component.
 */
export default function AskableSurface({
  storage,
  paper,
  sourcePageId,
  surfaceText,
  enableHighlight = false,
  onHighlight,
  enableSaveToNote = false,
  children,
}: AskableSurfaceProps) {
  const key = paperKey(paper)

  const [pendingSelection, setPendingSelection] = useState<SurfaceSelection | null>(null)
  const [captureNotice, setCaptureNotice] = useState<{ path: string } | null>(null)
  // The passage "Capture idea" was invoked on, snapshotted independently of
  // the live selection (independent of the live selection): typing in the card's
  // textarea collapses the native selection, which must not dismiss the card.
  const [captureState, setCaptureState] = useState<{
    target: SurfaceSelection
    saving: boolean
    error: string | null
  } | null>(null)

  // Read from a ref inside async handlers so a stale closure over an earlier
  // render's `surfaceText` can never anchor/ask against outdated text.
  const surfaceTextRef = useRef(surfaceText)
  useEffect(() => {
    surfaceTextRef.current = surfaceText
  }, [surfaceText])

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setPendingSelection(null)
  }, [])

  const onHtmlSelectionChange = useCallback((selection: SurfaceSelection | null) => {
    setPendingSelection(selection)
  }, [])

  const onPdfSelect = useCallback((start: number, end: number, selectedText: string) => {
    // pdf.js's own native selection is still live at this point (this fires
    // synchronously from PdfSurface's mouseup handler), so the same rect the
    // browser is showing can still be read here for the bubble's position.
    const rect = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect()
    setPendingSelection({
      start,
      end,
      text: selectedText,
      rectTop: rect?.top ?? 0,
      rectLeft: rect?.left ?? 0,
    })
  }, [])

  function handleHighlightClick() {
    if (!pendingSelection) return
    const sel = pendingSelection
    // Snapshot-then-clear before handing off: the caller's own highlight
    // handler is responsible only for persisting it, mirroring how the
    // Ask/Capture flows below always clear the live selection up front.
    clearSelection()
    onHighlight?.(sel)
  }

  function beginAsk() {
    if (!pendingSelection) return
    const target = pendingSelection
    clearSelection()
    askSparkyAboutSelection({ paperSlug: paperSlug(paper), selection: {
      text: target.text.slice(0, 6000),
      surrounding: computeSurroundingText(surfaceTextRef.current, target.start, target.end).slice(0, 7600),
    } })
  }

  // Open the inline capture card (replaces the old blocking window.prompt,
  // which embedded webviews don't implement at all — it threw in the in-app
  // preview browser).
  function handleCapture() {
    if (!pendingSelection) return
    setCaptureState({ target: pendingSelection, saving: false, error: null })
    clearSelection()
  }

  async function submitCapture(thought: string) {
    if (!captureState) return
    setCaptureState({ ...captureState, saving: true, error: null })
    try {
      const { path } = await captureIdeaAsNote({
        storage,
        paperKey: key,
        paperTitle: paper.title,
        sourcePageId,
        selection: captureState.target.text,
        thought,
        today: new Date().toISOString().slice(0, 10),
        apply: (_storage, changeset) => applyChangesetRemote(changeset),
      })
      setCaptureState(null)
      setCaptureNotice({ path })
    } catch (err) {
      // applyChangeset is all-or-nothing, so nothing was partially written —
      // surface the reason on the card instead of failing silently.
      setCaptureState({
        target: captureState.target,
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <>
      {children({ pendingSelection, onHtmlSelectionChange, onPdfSelect })}

      <SelectionBubble
        selection={pendingSelection}
        onAsk={beginAsk}
        onHighlight={enableHighlight ? handleHighlightClick : undefined}
        onCapture={handleCapture}
        onSaveToNote={enableSaveToNote ? () => {
          if (!pendingSelection) return
          const target = pendingSelection
          clearSelection()
          openSelectionNote({ text: target.text, top: target.rectTop, left: target.rectLeft,
            kind: "paper", refId: sourcePageId ?? key, refLabel: paper.title })
        } : undefined}
      />

      {captureState && (
        <CaptureIdeaCard
          selectionText={captureState.target.text}
          saving={captureState.saving}
          error={captureState.error}
          anchorTop={captureState.target.rectTop}
          anchorLeft={captureState.target.rectLeft}
          onSave={(thought) => void submitCapture(thought)}
          onCancel={() => setCaptureState(null)}
        />
      )}

      {captureNotice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 border border-border-warm rounded-btn bg-espresso text-white px-4 py-2 text-[13px] shadow-lg flex items-center gap-2 z-50">
          Idea captured.
          <Link href={wikiHref(captureNotice.path)} className="text-accent-ink-hover font-medium">
            View note
          </Link>
        </div>
      )}
    </>
  )
}
