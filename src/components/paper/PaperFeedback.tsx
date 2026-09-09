"use client"

import { useEffect, useState } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import { usePaperFeedbackStore } from "@/stores/paper-feedback-store"
import { useCompanionStore } from "@/stores/companion-store"
import { clearRecommendationFeedbackRemote, FEEDBACK_CHANGED_EVENT, sendRecommendationFeedback } from "@/lib/recommendation/client"
import type { FeedbackReason } from "@/lib/recommendation/contract"

export function PaperFeedback({ paperKey, title }: { paperKey: string; title: string }) {
  const state = usePaperFeedbackStore()
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const entry = state.entries[paperKey]
  const selected = entry?.reason === "more_like_this" ? "up" : entry && entry.reason !== "dismiss" ? "down" : null
  useEffect(() => {
    const reload = () => { void usePaperFeedbackStore.getState().reload() }
    reload()
    window.addEventListener(FEEDBACK_CHANGED_EVENT, reload)
    window.addEventListener("focus", reload)
    return () => { window.removeEventListener(FEEDBACK_CHANGED_EVENT, reload); window.removeEventListener("focus", reload) }
  }, [paperKey])
  async function vote(direction: "up" | "down") {
    const current = usePaperFeedbackStore.getState()
    if (current.pending[paperKey] || !current.ready || current.error) return
    current.setPending(paperKey, true)
    setError(null)
    try {
      if (selected === direction && entry?.revision) {
        const result = await clearRecommendationFeedbackRemote(paperKey, entry.revision)
        current.setEntry(paperKey, null)
        useCompanionStore.getState().closeFeedback(paperKey)
        setAnnouncement("Vote cleared.")
        if (result.warnings.length) setError("Vote cleared. History refresh reported a warning; do not submit again.")
      } else {
        const reason: FeedbackReason = direction === "up" ? "more_like_this" : "less_like_this"
        const result = await sendRecommendationFeedback(paperKey, reason, { expectedRevision: entry?.revision ?? null })
        current.setEntry(paperKey, { ...result.result, revision: result.revision })
        useCompanionStore.getState().closeFeedback(paperKey)
        if (direction === "down") useCompanionStore.getState().askFeedback({ paperKey, title, revision: result.revision })
        setAnnouncement(direction === "up" ? "More like this saved." : "Less like this saved.")
        if (result.warnings.length) setError("Vote saved. History refresh reported a warning; do not submit again.")
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your vote could not be saved.")
      await current.reload()
    } finally { current.setPending(paperKey, false) }
  }
  return <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <div className="flex items-center gap-1">
      {(["up", "down"] as const).map((direction) => {
        const Icon = direction === "up" ? ThumbsUp : ThumbsDown
        const active = selected === direction
        const label = direction === "up" ? "More like this" : "Less like this"
        return <button key={direction} type="button" aria-label={label} title={active ? `Clear ${label.toLowerCase()} vote` : label} aria-pressed={active}
          disabled={!state.ready || Boolean(state.error) || state.pending[paperKey]} onClick={() => void vote(direction)}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-orange disabled:opacity-40 ${active ? "bg-orange/15 text-orange" : "text-muted-text hover:bg-card-surface hover:text-espresso"}`}>
          <Icon size={17} fill={active ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      })}
    </div>
    <span role="status" className="sr-only">{announcement}</span>
    {(error || state.error) && <p role="alert" className="mt-2 max-w-xs text-[12px] text-espresso">{error || state.error}{state.error && <button type="button" className="ml-2 text-orange underline" onClick={() => void state.reload()}>Retry</button>}</p>}
  </div>
}
