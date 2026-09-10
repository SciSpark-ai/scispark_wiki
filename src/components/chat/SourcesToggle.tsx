"use client"

import { useId } from "react"

export interface SourcesToggleProps {
  value: boolean
  onChange: (value: boolean) => void
}

/** Restricts the existing chat context to saved papers, excluding other wiki pages. */
export function SourcesToggle({ value, onChange }: SourcesToggleProps) {
  const descriptionId = useId()
  return (
    <label className="flex cursor-pointer items-center justify-between gap-5 py-2 text-[13px] text-espresso tracking-body">
      <span className="min-w-0">
        <span className="block font-medium">Saved papers only</span>
        <span id={descriptionId} className="mt-1 block text-[12px] leading-relaxed text-muted-text">
          Exclude notes, ideas, and other wiki pages.
        </span>
      </span>
      <span className="relative flex h-11 w-10 shrink-0 items-center">
        <input type="checkbox" role="switch" aria-label="Saved papers only" aria-describedby={descriptionId}
          aria-checked={value} checked={value} onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" />
        <span aria-hidden="true" className="h-6 w-10 rounded-full border border-border-warm bg-card-surface transition-colors peer-checked:border-accent-ink peer-checked:bg-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent-ink" />
        <span aria-hidden="true" className="pointer-events-none absolute left-1 h-4 w-4 rounded-full bg-muted-text transition-transform peer-checked:translate-x-4 peer-checked:bg-page-bg motion-reduce:transition-none" />
      </span>
    </label>
  )
}
