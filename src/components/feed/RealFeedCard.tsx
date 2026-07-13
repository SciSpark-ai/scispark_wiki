"use client"

import { useRouter } from "next/navigation"
import type { FeedItem } from "@/lib/skills/feed"
import type { VaultStorage } from "@/lib/vault/storage"
import { paperKey } from "@/lib/papers/types"
import { logEvent } from "@/lib/events/log"
import { IdBadges } from "@/components/papers/IdBadges"

/** One card in the real personalized feed: title/authors/venue, id badges, the
 * three why-lines from the re-rank stage, a score chip, and Save/Dismiss/Read actions. */
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
  onDismiss: (key: string) => void
}) {
  const router = useRouter()
  const { paper } = item
  const key = paperKey(paper)

  const authorNames = paper.authors.map((a) => a.name)
  const authorsLabel =
    authorNames.length === 0
      ? "Unknown authors"
      : authorNames.length <= 3
        ? authorNames.join(", ")
        : `${authorNames.slice(0, 3).join(", ")}, et al.`

  function handleSave() {
    void logEvent(storage, { type: "feed_save", paperKey: key, title: paper.title })
    onSave(key)
  }

  function handleDismiss() {
    void logEvent(storage, { type: "feed_dismiss", paperKey: key, title: paper.title })
    onDismiss(key)
  }

  function handleReadDigest() {
    router.push(`/papers?paperKey=${encodeURIComponent(key)}`)
  }

  function handleRead() {
    router.push(`/reader?paperKey=${encodeURIComponent(key)}`)
  }

  return (
    <div className="border border-border-warm rounded-card px-4 py-3 bg-light-surface flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-heading text-[16px] text-espresso tracking-heading-card leading-snug">{paper.title}</h3>
        <span className="flex-shrink-0 text-[12px] text-white bg-orange rounded-pill px-2 py-0.5 font-medium">
          {Math.round(item.score)}
        </span>
      </div>

      <div className="text-[12px] text-muted-text tracking-body">{authorsLabel}</div>
      <div className="text-[12px] text-muted-text tracking-body">
        {paper.venue ?? "no venue"} · {paper.year ?? "—"}
      </div>

      <IdBadges ids={paper.ids} />

      <div className="mt-1 space-y-1 text-[13px]/[16px] text-espresso">
        <p>
          <span className="font-medium">Why this: </span>
          {item.whyThis}
        </p>
        <p>
          <span className="font-medium">Why you: </span>
          {item.whyYou}
        </p>
        <p>
          <span className="font-medium">Why now: </span>
          {item.whyNow}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saved}
          className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1 disabled:opacity-50"
        >
          {saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={handleRead}
          className="ml-auto text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1"
        >
          Read
        </button>
        <button
          type="button"
          onClick={handleReadDigest}
          className="text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-3 py-1 font-medium"
        >
          Read & digest
        </button>
      </div>
    </div>
  )
}
