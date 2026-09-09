"use client"

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react"

export interface CaptureIdeaCardProps {
  /** The passage being captured (snapshotted by ReaderView when the user
   * clicked "Capture idea" — independent of the live selection, same
   * pattern as the Ask flow's askTarget). */
  selectionText: string
  saving: boolean
  /** Save failure to surface inline — never fail silently. */
  error: string | null
  /** Viewport coordinates of the originating selection (same space
   * SelectionBubble uses), so the card appears where the user was reading. */
  anchorTop: number
  anchorLeft: number
  onSave: (thought: string) => void
  onCancel: () => void
}

const MIN_EDGE_MARGIN = 8
const VERTICAL_GAP = 12

/**
 * Inline replacement for the old `window.prompt("Add a thought…")` in the
 * capture-idea flow — `prompt()` blocks, can't be styled, and simply throws
 * in embedded webviews (the in-app preview browser today, a Tauri wrapper
 * post-v1). Renders a small fixed-position card at the selection with an
 * optional-thought textarea; Escape or Cancel dismisses, Save hands the
 * thought to the caller, and a failed save renders its reason inline.
 */
export default function CaptureIdeaCard({
  selectionText,
  saving,
  error,
  anchorTop,
  anchorLeft,
  onSave,
  onCancel,
}: CaptureIdeaCardProps) {
  const [thought, setThought] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    onSave(thought.trim())
  }

  const style: CSSProperties = {
    position: "fixed",
    top: Math.max(MIN_EDGE_MARGIN, anchorTop + VERTICAL_GAP),
    left: Math.max(MIN_EDGE_MARGIN, anchorLeft),
    zIndex: 50,
  }

  return (
    <div
      role="dialog"
      aria-label="Capture idea"
      style={style}
      className="w-[320px] rounded-card border border-border-warm bg-light-surface shadow-lg px-3 py-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel()
      }}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-text">Capture idea</div>
      <div className="mt-1 text-[12px]/[17px] text-espresso line-clamp-3">{selectionText}</div>

      <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={thought}
          onChange={(e) => setThought(e.target.value)}
          placeholder="Add a thought (optional)…"
          rows={3}
          className="text-[13px] text-espresso border border-border-warm rounded-card px-3 py-2 bg-card-surface"
        />
        {error && (
          <div className="text-[12px]/[16px] text-red-600" role="alert">
            Couldn&apos;t save: {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="text-[13px] text-on-accent bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-[13px] text-muted-text hover:text-espresso rounded-pill px-3 py-1.5"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
