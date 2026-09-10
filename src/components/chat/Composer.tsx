"use client"

import type { KeyboardEvent } from "react"
import { ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/Button"

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  placeholder?: string
  welcome?: boolean
}

/**
 * The chat input row. Enter submits; Shift+Enter inserts a newline instead
 * (the repo-wide convention for a submit-on-Enter textarea — mirrors
 * CaptureIdeaCard's handling, minus the Escape-to-cancel behavior that's
 * specific to that popover). Both the textarea and the submit button are
 * disabled while `busy`; the button is additionally disabled on
 * empty/whitespace-only input so there's nothing to submit.
 *
 * IME composition guard: while an IME candidate is being composed (Chinese/
 * Japanese/Korean input, among others), the Enter that commits the candidate
 * fires as a normal "Enter" keydown — without this guard it would also
 * submit a half-typed question. `isComposing` on the native event is the
 * correct signal (`keyCode === 229` is the same signal on browsers/IMEs that
 * don't set `isComposing`, kept as a fallback). This same gap exists
 * elsewhere in the repo wherever Enter-submits a textarea (e.g.
 * CaptureIdeaCard's implicit form submit) — fixed here only; worth a
 * dedicated pass to close it everywhere.
 */
export function Composer({ value, onChange, onSubmit, busy, welcome = false, placeholder = "Ask about your knowledge base…" }: ComposerProps) {
  const canSubmit = !busy && value.trim() !== ""

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    e.preventDefault()
    if (canSubmit) onSubmit()
  }

  return (
    <div className={welcome ? "flex items-end gap-3 rounded-[24px] border border-border-warm bg-light-surface p-4 shadow-sm focus-within:ring-2 focus-within:ring-accent-ink" : "flex items-end gap-2"}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={busy}
        rows={2}
        placeholder={placeholder}
        aria-label="Message Sparky"
        className={welcome ? "min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[16px] leading-6 text-espresso outline-none placeholder:text-muted-text disabled:opacity-50" : "min-w-0 flex-1 resize-none rounded-[12px] border border-border-warm bg-light-surface focus:outline-2 focus:outline-accent-ink px-3 py-2 text-[14px] text-espresso tracking-body disabled:opacity-50"}
      />
      {welcome ? <button type="button" aria-label="Send" onClick={onSubmit} disabled={!canSubmit}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange text-on-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-ink disabled:opacity-40">
        <ArrowUp size={20} aria-hidden="true" />
      </button> : <Button onClick={onSubmit} disabled={!canSubmit}>Send</Button>}
    </div>
  )
}
