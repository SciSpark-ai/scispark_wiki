"use client"

import { useState, type KeyboardEvent, type MouseEvent } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import { useCompanionStore } from "@/stores/companion-store"
import { useRouter } from "next/navigation"
import type { FeedBadge, FeedItem } from "@/lib/skills/feed"
import type { VaultStorage } from "@/lib/vault/storage"
import { paperKey } from "@/lib/papers/types"
import { paperSlug } from "@/lib/wiki/authoring"
import { displayTitle } from "@/lib/papers/title"
import { venueYearLine } from "@/lib/papers/venue"
import { savePaper } from "@/lib/papers/save-client"
import { sendRecommendationFeedback } from "@/lib/recommendation/client"
import { FEEDBACK_LABELS, type FeedbackReason } from "@/lib/recommendation/contract"
import { RecommendationDetails } from "./RecommendationDetails"
import { Card } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"

/**
 * Per-badge band label + color (tokens from globals.css — the no-raw-hex
 * guard applies here). One entry per FEED_BADGE_VALUES member; the Record
 * type makes adding a badge without a band a compile error.
 */
const BAND: Record<FeedBadge, { label: string; className: string }> = {
  "high-impact": { label: "High impact", className: "bg-band-impact text-white" },
  breakthrough: { label: "Breakthrough", className: "bg-band-breakthrough text-white" },
  "new-method": { label: "New method", className: "bg-band-method text-white" },
  trending: { label: "Trending", className: "bg-band-trending text-white" },
  "new-evidence": { label: "New evidence", className: "bg-band-evidence text-white" },
  review: { label: "Review", className: "bg-band-review text-white" },
  application: { label: "Application", className: "bg-band-application text-white" },
  dataset: { label: "Dataset", className: "bg-band-dataset text-white" },
}

/** Band content for an item: its why-badge, or (old caches without one) a
 * neutral strip carrying the first topical tag / the source name. */
function bandFor(item: FeedItem): { label: string; className: string } {
  if (item.badge) return BAND[item.badge]
  const fallback = item.tags?.[0] ?? item.paper.source
  return { label: fallback, className: "bg-warm-tan text-espresso" }
}

/**
 * One compact card in the personalized feed (SP2.1 redesign — Tong's
 * 2026-07-19 walk: "small cards … with a color head", why-reason ON the
 * band). Landing-page-style: a colored header band showing the re-rank's
 * why-badge ("High impact" / "New method" / …), then headline + AI TL;DR +
 * small topical tag chips, venue·year and Save/Dismiss in the footer. The
 * WHOLE card links through to `/paper/<slug>` where the full why-lines and
 * actions live; the footer stops click-propagation so its buttons don't
 * also navigate. Rendered in a 2–3-column grid (see src/app/page.tsx).
 */
export function RealFeedCard({
  item,
  storage,
  saved,
  onSave,
  onDismiss,
}: {
  item: FeedItem
  storage: VaultStorage
  saved: boolean
  onSave: (key: string) => void
  onDismiss: (key: string, notice?: string) => void
}) {
  const router = useRouter()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackPending, setFeedbackPending] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const { paper } = item
  const key = paperKey(paper)
  const href = `/paper/${paperSlug(paper)}`

  const band = bandFor(item)
  // `title` attr carries the full line so a still-too-long venue is
  // recoverable on hover rather than silently lost to the truncation.
  const metaLine = venueYearLine(paper.venue, paper.year)
  const tldr = item.tldr ?? paper.abstract?.split(". ")[0]
  const tags =
    item.tags && item.tags.length > 0
      ? item.tags
      : [paper.source, paper.year != null ? String(paper.year) : undefined].filter((v): v is string => Boolean(v))

  function goToPaper() {
    router.push(href)
  }

  function handleCardKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      goToPaper()
    }
  }

  async function handleSave(e: MouseEvent) {
    e.stopPropagation()
    if (saved) return
    // savePaper itself logs the feed_save event (see save-client.ts), so no
    // separate logEvent call here — logging it twice would double-count.
    await savePaper(storage, paper)
    onSave(key)
  }

  async function handleFeedback(reason: FeedbackReason) {
    if (feedbackPending) return
    setFeedbackPending(true)
    setFeedbackMessage(null)
    try {
      const result = await sendRecommendationFeedback(key, reason)
      setFeedbackOpen(false)
      const notice = result.warnings.length ? "Feedback saved. History refresh reported a warning; do not submit again." : "Feedback saved. You can undo it in History."
      setFeedbackMessage(notice)
      if (reason === "less_like_this") useCompanionStore.getState().askFeedback({ paperKey: key, title: displayTitle(paper.title), revision: result.revision })
      // Preference feedback changes future recommendations, not the current feed.
      if (reason === "dismiss") onDismiss(key, notice)
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : String(error))
    } finally { setFeedbackPending(false) }
  }

  return (
    <Card
      onClick={goToPaper}
      onKeyDown={handleCardKeyDown}
      role="link"
      tabIndex={0}
      className="p-0 overflow-hidden flex flex-col cursor-pointer hover:shadow-sm transition-shadow"
    >
      <div className={`px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${band.className}`}>
        {band.label}
      </div>

      <div className="px-4 py-3 flex flex-col gap-2 flex-1">
        <h3 className="font-heading text-[15px] text-espresso tracking-heading-card leading-snug line-clamp-3">
          {displayTitle(paper.title)}
        </h3>

        {tldr && <p className="text-[13px] leading-[1.5] text-espresso tracking-body line-clamp-3">{tldr}</p>}

        {item.ranking && <>
          <p className="text-[11px] text-muted-text">{item.ranking.dateStatus === "unknown" ? "Publication date unavailable" : `Published ${paper.date?.slice(0, 10)}`}</p>
          <RecommendationDetails ranking={item.ranking} />
        </>}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="min-w-0 truncate text-[11px] text-muted-text tracking-body" title={metaLine}>
            {metaLine}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={handleSave} disabled={saved}>
              {saved ? "Saved" : "Save"}
            </Button>
            <button type="button" aria-label="More like this" title="More like this" disabled={feedbackPending} onClick={() => void handleFeedback("more_like_this")} className="rounded-full p-2 text-muted-text hover:text-orange focus-visible:ring-2 focus-visible:ring-orange disabled:opacity-40"><ThumbsUp size={16} /></button>
            <button type="button" aria-label="Less like this" title="Less like this" disabled={feedbackPending} onClick={() => void handleFeedback("less_like_this")} className="rounded-full p-2 text-muted-text hover:text-orange focus-visible:ring-2 focus-visible:ring-orange disabled:opacity-40"><ThumbsDown size={16} /></button>
            <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); setFeedbackOpen(!feedbackOpen) }} disabled={feedbackPending}>
              Feedback
            </Button>
          </div>
        </div>
        {feedbackOpen && <div className="flex flex-wrap gap-2 border-t border-border-warm pt-3" onClick={(event) => event.stopPropagation()}>
          {(["too_old", "already_know", "dismiss"] as FeedbackReason[]).map((reason) => <button key={reason} type="button" disabled={feedbackPending} onClick={() => void handleFeedback(reason)} className="rounded-pill border border-border-warm px-3 py-1.5 text-[12px] text-espresso hover:bg-card-surface disabled:opacity-50">{FEEDBACK_LABELS[reason]}</button>)}
        </div>}
        {feedbackMessage && <p role="status" className="text-[12px] text-muted-text">{feedbackMessage}</p>}
      </div>
    </Card>
  )
}
