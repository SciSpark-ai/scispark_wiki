"use client"
import { Bookmark } from "lucide-react"

export function PaperSaveButton({ saved, busy = false, onSave }: { saved: boolean; busy?: boolean; onSave: () => void }) {
  return <button type="button" aria-label={saved ? "Saved" : "Save"} aria-pressed={saved} title={saved ? "Saved in your Wiki" : "Save paper"}
    disabled={busy} onClick={(event) => { event.stopPropagation(); if (!saved) onSave() }}
    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-orange disabled:opacity-40 ${saved ? "bg-orange/15 text-accent-ink" : "text-muted-text hover:bg-card-surface hover:text-espresso"}`}>
    <Bookmark size={17} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
  </button>
}
