import type { PaperRecord } from "@/lib/papers/types"
import { displayTitle } from "@/lib/papers/title"
import { IdBadges } from "./IdBadges"

/** One selectable row in the search results list. */
export function PaperResultItem({
  paper,
  selected,
  onSelect,
}: {
  paper: PaperRecord
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left border rounded-card px-3 py-2 transition-colors ${
        selected ? "border-orange bg-light-surface" : "border-border-warm bg-light-surface hover:border-orange/50"
      }`}
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
