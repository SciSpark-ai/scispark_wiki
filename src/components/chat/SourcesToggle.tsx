"use client"

export interface SourcesToggleProps {
  value: boolean
  onChange: (value: boolean) => void
}

/**
 * Labelled switch for Read-Sources-Only (SP5 Task 6's orchestrator flag,
 * `AskChatInput.readSourcesOnly`): narrows the chat's candidate pool to
 * saved papers only, skipping notes/ideas/other wiki pages. A native
 * checkbox styled as a pill switch, `role="switch"` so it reads correctly
 * regardless of the visual styling.
 */
export function SourcesToggle({ value, onChange }: SourcesToggleProps) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-espresso tracking-body">
      <input
        type="checkbox"
        role="switch"
        aria-checked={value}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-7 shrink-0 cursor-pointer appearance-none rounded-pill border border-border-warm bg-card-surface transition-colors checked:bg-orange"
      />
      <span>
        Read Sources Only
        <span className="ml-1 text-muted-text">
          — answers draw only from your saved papers, not notes, ideas, or other wiki pages.
        </span>
      </span>
    </label>
  )
}
