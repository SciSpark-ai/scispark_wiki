import type { PaperRecord } from "@/lib/papers/types"
import { displayTitle } from "@/lib/papers/title"
import { IdBadges } from "./IdBadges"

/**
 * One row in the search results list. Selecting it opens the paper's own
 * `/paper/<slug>` page (SP2 Task 13) — the crammed inline detail/digest
 * sub-card that used to render on `/papers` itself is gone, so this is now a
 * dumb row with no "selected" highlight state to track. The page owns
 * stashing a reader handoff (a fresh search result isn't in the feed cache
 * or wiki yet) and navigating, via `onSelect`.
 */
export function PaperResultItem({
  paper,
  onSelect,
}: {
  paper: PaperRecord
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left border border-border-warm bg-light-surface hover:border-orange/50 rounded-card px-3 py-2 transition-colors"
    >
      <div className="font-heading text-[15px] text-espresso tracking-heading-card leading-snug">
        {displayTitle(paper.title)}
      </div>
      <div className="mt-1 text-[12px] text-muted-text tracking-body">
        {paper.year ?? "—"} · {paper.venue ?? "no venue"} · {paper.citationCount ?? 0} citations
      </div>
      <div className="mt-1.5">
        <IdBadges ids={paper.ids} />
      </div>
    </button>
  )
}
