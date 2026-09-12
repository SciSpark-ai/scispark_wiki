"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { wikiHref } from "@/lib/wiki/href"
import { StreamingReply } from "@/components/chat/StreamingReply"

export type AskState =
  | { status: "idle" }
  | { status: "loading"; text?: string }
  | { status: "done"; answer: string; citedPageIds: string[]; question?: string }
  | { status: "error"; message: string }

export interface AskPanelProps {
  /** The passage the user currently has selected (via SelectionBubble's "Ask"
   * button), or null when nothing is selected — the panel stays usable
   * either way, but a question can only be sent once a passage is selected
   * (the Reading-Companion skill always answers about a specific passage). */
  selectionText: string | null
  state: AskState
  onAsk: (question: string) => void
  onIntegrate?: () => void
  integration?: { status: "idle" | "saving" | "saved" | "error"; pageId?: string; message?: string }
}

/**
 * The right-hand select-to-ask panel: shows the currently selected passage
 * (if any), a question input, and the Reading-Companion's grounded answer
 * with its cited wiki pages linked. Answers render as plain text only —
 * never `dangerouslySetInnerHTML` (M6 plan Global Constraints: LLM output is
 * untrusted).
 */
export default function AskPanel({ selectionText, state, onAsk, onIntegrate, integration }: AskPanelProps) {
  const [question, setQuestion] = useState("")

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectionText || state.status === "loading") return
    onAsk(question.trim())
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border-warm bg-light-surface">
      <div className="shrink-0 border-b border-border-warm px-4 py-3">
        <h2 className="font-heading text-[16px] text-espresso tracking-heading-card">Ask</h2>
      </div>

      <div data-ask-content className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {selectionText ? (
          <div className="rounded-btn border border-border-warm bg-card-surface px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-text">Selected passage</div>
            <div className="mt-1 text-[13px]/[18px] text-espresso line-clamp-6">{selectionText}</div>
          </div>
        ) : (
          <div className="text-[13px] text-muted-text tracking-body">
            Select text in the paper, then choose &quot;Ask&quot; to ask about that passage.
          </div>
        )}

        {state.status === "error" && <LlmErrorMessage message={state.message} />}
        {state.status === "loading" && <div className="mt-3"><StreamingReply text={state.text ?? ""} /></div>}

        {state.status === "done" && (
          <div className="mt-4">
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
            {onIntegrate && (
              <div className="mt-4 border-t border-border-warm pt-3">
                {integration?.status === "saved" && integration.pageId ? (
                  <p className="text-[13px] text-muted-text" role="status">Integrated into wiki. <Link href={wikiHref(integration.pageId)} className="text-accent-ink hover:text-accent-ink-hover">View wiki page</Link></p>
                ) : (
                  <button type="button" onClick={onIntegrate} disabled={integration?.status === "saving"} className="rounded-btn border border-border-warm px-3 py-2 text-[13px] font-medium text-accent-ink hover:bg-card-surface disabled:opacity-50">
                    {integration?.status === "saving" ? "Integrating…" : "Integrate into wiki"}
                  </button>
                )}
                {integration?.message && <p role={integration.status === "error" ? "alert" : "status"} className="mt-2 text-[12px] text-muted-text">{integration.message}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex shrink-0 flex-col gap-2 border-t border-border-warm bg-light-surface px-4 py-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Ask about the selected passage"
          placeholder={state.status === "done" ? "Ask a follow-up…" : "Ask about this passage…"}
          rows={2}
          disabled={!selectionText}
          className="text-[13px] text-espresso border border-border-warm rounded-btn px-3 py-2 bg-light-surface resize-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!selectionText || state.status === "loading"}
          className="self-start text-[13px] text-on-accent bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
        >
          {state.status === "loading" ? "Asking…" : "Ask"}
        </button>
      </form>
    </div>
  )
}
