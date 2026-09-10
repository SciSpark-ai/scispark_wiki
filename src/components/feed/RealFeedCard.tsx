"use client"

import { useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import type { FeedItem } from "@/lib/skills/feed"
import type { VaultStorage } from "@/lib/vault/storage"
import { paperKey } from "@/lib/papers/types"
import { paperSlug } from "@/lib/wiki/authoring"
import { displayTitle } from "@/lib/papers/title"
import { venueYearLine } from "@/lib/papers/venue"
import { paperCategory, publicationLabel, type PaperCategory } from "@/lib/papers/eligibility"
import { savePaper } from "@/lib/papers/save-client"
import { RecommendationDetails } from "./RecommendationDetails"
import { PaperFeedback } from "@/components/paper/PaperFeedback"
import { PaperSaveButton } from "@/components/paper/PaperSaveButton"
import { Card } from "@/components/ui/Card"
import { Chip } from "@/components/ui/Chip"
import { GrainOverlay } from "@/components/shared/GrainOverlay"

const CATEGORY_COLOR: Record<PaperCategory, string> = {
  "Methods": "bg-paper-header-methods",
  "Research findings": "bg-paper-header-findings",
  "Review / synthesis": "bg-paper-header-review",
  "Data & tools": "bg-paper-header-tools",
}

export function RealFeedCard({ item, storage, saved, onSave }: {
  item: FeedItem; storage: VaultStorage; saved: boolean; onSave: (key: string) => void
  /** Kept for existing callers; votes never dismiss a paper. */
  onDismiss?: (key: string, notice?: string) => void
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { paper } = item
  const key = paperKey(paper)
  const category = paperCategory(paper)
  const publication = publicationLabel(paper)
  const title = displayTitle(paper.title)
  const metaLine = venueYearLine(paper.venue, paper.year)
  const tldr = item.tldr ?? paper.abstract?.replace(/^abstract\s*:?\s*/i, "").split(". ")[0]
  const tags = (item.tags?.length ? item.tags : paper.fields).slice(0, 3)
  function goToPaper() { router.push(`/paper/${paperSlug(paper)}`) }
  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); goToPaper() }
  }
  async function handleSave() {
    if (saved || saving) return
    setSaving(true)
    setSaveError(null)
    try { await savePaper(storage, paper); onSave(key) }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : "This paper could not be saved.") }
    finally { setSaving(false) }
  }
  return <Card onClick={goToPaper} onKeyDown={handleCardKeyDown} role="link" tabIndex={0}
    className="flex cursor-pointer flex-col overflow-hidden p-0 transition-shadow hover:shadow-sm">
    <div data-paper-category={category} className={`relative isolate flex flex-wrap items-center justify-between gap-2 overflow-hidden px-4 py-2 text-[12px] text-espresso ${CATEGORY_COLOR[category]}`}>
      <GrainOverlay intensity="light" />
      <span className="relative">{category}</span>
      {publication && <span className="relative rounded-pill border border-border-warm bg-light-surface px-2 py-0.5 text-[11px]">{publication}</span>}
    </div>
    <div className="flex flex-1 flex-col gap-3 px-4 py-4">
      <h3 className="font-heading text-[19px] leading-snug tracking-heading-card text-espresso line-clamp-3">{title}</h3>
      {tldr && <p className="text-[13px] leading-relaxed text-espresso line-clamp-3">{tldr}</p>}
      {item.ranking && <RecommendationDetails ranking={item.ranking} />}
      {tags.length > 0 && <div className="flex flex-wrap gap-1.5">{tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>}
      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-border-warm/60 pt-3" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-text">
          <p title={metaLine} className="truncate">{metaLine}</p>
          <p>{paper.date ? `Published ${paper.date.slice(0, 10)}` : "Publication date unavailable"}</p>
        </div>
        <div className="flex items-start gap-1">
          <PaperSaveButton saved={saved} busy={saving} onSave={() => void handleSave()} />
          <PaperFeedback paperKey={key} title={title} />
        </div>
      </div>
      {saveError && <p role="alert" className="text-[12px] text-espresso">{saveError}</p>}
    </div>
  </Card>
}
