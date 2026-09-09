"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { wikiHref } from "@/lib/wiki/href"
import { StreamingReply } from "@/components/chat/StreamingReply"

export type AskState =
  | { status: "idle" }
  | { status: "loading"; text?: string }
  | { status: "done"; answer: string; citedPageIds: string[] }
  | { status: "error"; message: string }

export interface AskPanelProps {
  /** The passage the user currently has selected (via SelectionBubble's "Ask"
   * button), or null when nothing is selected — the panel stays usable
   * either way, but a question can only be sent once a passage is selected
   * (the Reading-Companion skill always answers about a specific passage). */
  selectionText: string | null
  state: AskState
  onAsk: (question: string) => void
}

/**
 * The right-hand select-to-ask panel: shows the currently selected passage
 * (if any), a question input, and the Reading-Companion's grounded answer
 * with its cited wiki pages linked. Answers render as plain text only —
 * never `dangerouslySetInnerHTML` (M6 plan Global Constraints: LLM output is
 * untrusted).
 */
export default function AskPanel({ selectionText, state, onAsk }: AskPanelProps) {
  const [question, setQuestion] = useState("")

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectionText || state.status === "loading") return
    onAsk(question.trim())
  }

  return (
    <div className="flex h-full flex-col border-l border-border-warm bg-light-surface">
      <div className="border-b border-border-warm px-4 py-3">
        <h2 className="font-heading text-[16px] text-espresso tracking-heading-card">Ask</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {selectionText ? (
          <div className="rounded-card border border-border-warm bg-card-surface px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-text">Selected passage</div>
            <div className="mt-1 text-[13px]/[18px] text-espresso line-clamp-6">{selectionText}</div>
          </div>
        ) : (
          <div className="text-[13px] text-muted-text tracking-body">
            Select text in the paper, then choose &quot;Ask&quot; to ask about that passage.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Explain this passage… (optional)"
            rows={2}
            disabled={!selectionText}
            className="text-[13px] text-espresso border border-border-warm rounded-card px-3 py-2 bg-light-surface disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!selectionText || state.status === "loading"}
            className="self-start text-[13px] text-on-accent bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
          >
            {state.status === "loading" ? "Asking…" : "Ask"}
          </button>
        </form>

        {state.status === "error" && <LlmErrorMessage message={state.message} />}
        {state.status === "loading" && <div className="mt-3"><StreamingReply text={state.text ?? ""} /></div>}

        {state.status === "done" && (
          <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-card-surface">
            <div className="text-[13px]/[19px] text-espresso whitespace-pre-wrap">{state.answer}</div>
            {state.citedPageIds.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-text">Sources</div>
                <ul className="mt-1 space-y-0.5">
                  {state.citedPageIds.map((id) => (
                    <li key={id}>
                      <Link href={wikiHref(id)} className="text-[13px] text-accent-ink hover:text-accent-ink-hover">
                        {id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
