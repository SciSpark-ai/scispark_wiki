"use client"

import { Button } from "@/components/ui/Button"
import { cn } from "@/components/ui/cn"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { displayTitle } from "@/lib/papers/title"
import type { ChatMessage } from "@/lib/chat/session"
import { CitationChips } from "./CitationChips"

export interface MessageBubbleProps {
  message: ChatMessage
  pageTitleById: Record<string, string>
  /** Save-this-answer-as-a-query-page control (SP5 Task 7). Presentational —
   * the caller owns what "save" actually does. */
  onSave: () => void
  saving: boolean
}

function lastSegment(id: string): string {
  const segments = id.split("/")
  return segments[segments.length - 1]
}

function labelFor(id: string, pageTitleById: Record<string, string>): string {
  const title = pageTitleById[id]
  return title ? displayTitle(title) : lastSegment(id)
}

/**
 * One turn in the KB-chat stream. A degraded turn (SP5 Task 6's orchestrator)
 * is a normal successful response, not a transport failure — `error`,
 * `selectionFallback`, and `skippedPageIds` all live on the message itself
 * and are rendered from it here, never inferred from a request having failed.
 * All assistant-only affordances (citations, the skipped/fallback notes, the
 * Save control) are gated on `isAssistant`, so an odd caller-supplied shape
 * (e.g. a `role: "user"` message that somehow carries `citedPageIds`) can't
 * make them render.
 *
 * `error` never yields an empty bubble: when there's no real `content` to
 * show (the answer step itself failed), the error text becomes the body;
 * when content IS present (e.g. a page failed to read but the rest of the
 * answer still came back), the error rides along as a quiet "Reason:" line
 * underneath it — same pattern as the trending dashboard's `surveyError`.
 */
export function MessageBubble({ message, pageTitleById, onSave, saving }: MessageBubbleProps) {
  const isAssistant = message.role === "assistant"
  const hasContent = message.content.trim() !== ""
  const citedPageIds = message.citedPageIds ?? []
  const skippedPageIds = message.skippedPageIds ?? []
  const truncatedPageIds = message.truncatedPageIds ?? []
  // A degraded-but-answered turn (selectionFallback/skippedPageIds set, but
  // real content present) is still a legitimate answer worth saving — only
  // an error-only turn (nothing was actually answered) is not saveable, so
  // writing it as a `query` page would put an empty/failed answer into the
  // knowledge base permanently.
  const canSave = isAssistant && hasContent && !message.error

  return (
    <div
      className={cn(
        "rounded-card border border-border-warm px-4 py-3",
        isAssistant ? "bg-light-surface" : "bg-card-surface",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-text">{isAssistant ? "Assistant" : "You"}</div>

      {hasContent && (
        <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.5] text-espresso tracking-body">
          {message.content}
        </p>
      )}

      {isAssistant && message.error && (
        <div className="mt-2">
          <LlmErrorMessage message={hasContent ? `Reason: ${message.error}` : message.error} />
        </div>
      )}

      {isAssistant && message.selectionFallback && (
        <p className="mt-2 text-[12px] text-muted-text tracking-body">
          Context was chosen by keyword match, not the AI page selector.
        </p>
      )}

      {isAssistant && skippedPageIds.length > 0 && (
        <p className="mt-2 text-[12px] text-muted-text tracking-body">
          Couldn&apos;t read: {skippedPageIds.map((id) => labelFor(id, pageTitleById)).join(", ")}
        </p>
      )}

      {isAssistant && truncatedPageIds.length > 0 && (
        <p className="mt-2 text-[12px] text-muted-text tracking-body">
          Context limit reached for: {truncatedPageIds.map((id) => labelFor(id, pageTitleById)).join(", ")}
        </p>
      )}

      {isAssistant && citedPageIds.length > 0 && (
        <CitationChips pageIds={citedPageIds} pageTitleById={pageTitleById} />
      )}

      {canSave && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save to knowledge base"}
          </Button>
        </div>
      )}
    </div>
  )
}
