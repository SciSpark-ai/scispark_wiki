"use client"

import type { KeyboardEvent, MouseEvent } from "react"
import { useRouter } from "next/navigation"
import type { FeedItem } from "@/lib/skills/feed"
import type { VaultStorage } from "@/lib/vault/storage"
import { paperKey } from "@/lib/papers/types"
import { paperSlug } from "@/lib/wiki/authoring"
import { displayTitle } from "@/lib/papers/title"
import { savePaper } from "@/lib/papers/save-client"
import { logEvent } from "@/lib/events/log"
import { IdBadges } from "@/components/papers/IdBadges"
import { Card } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"

/**
 * One scannable card in the real personalized feed (SP2 Task 12 redesign):
 * headline + venue·year + an AI TL;DR + a small tag-chip row — Apple-News
 * style, not a wall of prose. The WHOLE card links through to
 * `/paper/<slug>`, where the full why-this/you/now explanations now live
 * (see `PaperActions`/`PaperMeta` on that page) along with Read/digest
 * actions, so this card no longer duplicates them. Only Save and Dismiss
 * remain as a footer that stops click-propagation so clicking them doesn't
 * also trigger the card's navigation.
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
  onDismiss: (key: string) => void
}) {
  const router = useRouter()
  const { paper } = item
  const key = paperKey(paper)
  const href = `/paper/${paperSlug(paper)}`

  const tldr = item.tldr ?? paper.abstract?.split(". ")[0]
  const tags =
    item.tags && item.tags.length > 0
      ? item.tags
      : [paper.source, paper.year != null ? String(paper.year) : undefined].filter((v): v is string => Boolean(v))

  function goToPaper() {
    router.push(href)
  }

  function handleCardKeyDown(e: KeyboardEvent<HTMLDivElement>) {
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

  function handleDismiss(e: MouseEvent) {
    e.stopPropagation()
    void logEvent(storage, { type: "feed_dismiss", paperKey: key, title: paper.title })
    onDismiss(key)
  }

  return (
    <Card
      onClick={goToPaper}
      onKeyDown={handleCardKeyDown}
      role="link"
      tabIndex={0}
      className="px-4 py-3 flex flex-col gap-2 cursor-pointer hover:shadow-sm transition-shadow"
    >
      <h3 className="font-heading text-[16px] text-espresso tracking-heading-card leading-snug">{displayTitle(paper.title)}</h3>

      <div className="text-[12px] text-muted-text tracking-body">
        {paper.venue ?? "no venue"} · {paper.year ?? "—"}
      </div>

      {tldr && <p className="text-[13px] leading-[1.5] text-espresso tracking-body">{tldr}</p>}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      )}

      <IdBadges ids={paper.ids} />

      <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button variant="secondary" size="sm" onClick={handleSave} disabled={saved}>
          {saved ? "Saved" : "Save"}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleDismiss}>
          Dismiss
        </Button>
      </div>
    </Card>
  )
}
