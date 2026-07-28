"use client"

import type { KeyboardEvent } from "react"
import { Button } from "@/components/ui/Button"

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
}

/**
 * The chat input row. Enter submits; Shift+Enter inserts a newline instead
 * (the repo-wide convention for a submit-on-Enter textarea — mirrors
 * CaptureIdeaCard's handling, minus the Escape-to-cancel behavior that's
 * specific to that popover). Both the textarea and the submit button are
 * disabled while `busy`; the button is additionally disabled on
 * empty/whitespace-only input so there's nothing to submit.
 */
export function Composer({ value, onChange, onSubmit, busy }: ComposerProps) {
  const canSubmit = !busy && value.trim() !== ""

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return
    e.preventDefault()
    if (canSubmit) onSubmit()
  }

  return (
    <div className="flex items-end gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={busy}
        rows={2}
        placeholder="Ask about your knowledge base…"
        className="flex-1 resize-none rounded-card border border-border-warm bg-light-surface px-3 py-2 text-[14px] text-espresso tracking-body disabled:opacity-50"
      />
      <Button onClick={onSubmit} disabled={!canSubmit}>
        Send
      </Button>
    </div>
  )
}
