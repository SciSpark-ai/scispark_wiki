"use client"

import { useEffect } from "react"
import { Card } from "@/components/ui/Card"

export interface DeleteConfirmCardProps {
  title: string
  backlinks: number
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Inline delete-confirmation card for the wiki page action row — never
 * `window.confirm` (embedded webviews don't implement it; the same rule
 * that drove the CaptureIdeaCard rewrite). Esc cancels; a failed delete
 * surfaces its reason inline via `error` rather than being swallowed.
 */
export default function DeleteConfirmCard({
  title,
  backlinks,
  busy,
  error,
  onConfirm,
  onCancel,
}: DeleteConfirmCardProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  return (
    <Card role="dialog" aria-label="Delete page" className="mt-3 px-4 py-3">
      <p className="text-[13px] text-espresso">
        Delete &ldquo;{title}&rdquo;? This cannot be undone from here, but the change stays
        reversible from the review inbox.
      </p>
      {backlinks > 0 && (
        <p className="mt-1 text-[12px] text-muted-text">
          {backlinks} page{backlinks === 1 ? "" : "s"} link here
        </p>
      )}
      {error && (
        <p className="mt-2 text-[12px] text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="text-[13px] text-red-600 hover:text-red-700 rounded-pill border border-border-warm px-4 py-1.5 font-medium transition-colors disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[13px] text-muted-text hover:text-espresso rounded-pill px-3 py-1.5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </Card>
  )
}
