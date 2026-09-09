import { Sparkles } from "lucide-react"
import type { ResearchSearchItem } from "@/lib/skills/research-search-contract"
import { displayTitle } from "@/lib/papers/title"
import { IdBadges } from "./IdBadges"

const SOURCE_LABELS: Record<string, string> = {
  arxiv: "arXiv",
  openalex: "OpenAlex",
  s2: "Semantic Scholar",
  pubmed: "PubMed",
}

export function ResearchSearchResultItem({
  item,
  index,
  onSelect,
}: {
  item: ResearchSearchItem
  index: number
  onSelect: () => void
}) {
  const { paper } = item
  const authors = paper.authors.slice(0, 4).map((author) => author.name).join(", ")
  const extraAuthors = paper.authors.length > 4 ? ` +${paper.authors.length - 4}` : ""
  const sources = [...new Set(item.foundBy.map((entry) => entry.source))]

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group grid w-full grid-cols-[34px_minmax(0,1fr)] gap-3 border-b border-border-warm py-5 text-left first:pt-0 last:border-b-0 last:pb-0 focus-visible:rounded-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 sm:grid-cols-[42px_minmax(0,1fr)] sm:gap-4 sm:py-6"
      aria-label={`Open ${displayTitle(paper.title)}`}
    >
      <span className="pt-1 font-heading text-[17px] text-muted-text">{String(index + 1).padStart(2, "0")}</span>
      <div className="min-w-0">
        <span className="block font-heading text-[20px] leading-[1.2] tracking-heading-card text-espresso transition-colors group-hover:text-accent-ink sm:text-[23px]">
          {displayTitle(paper.title)}
        </span>
        <span className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-secondary-dark">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-accent-ink" aria-hidden="true" />
          <span>{item.whyMatch}</span>
        </span>
        {paper.abstract && (
          <span className="mt-2 block line-clamp-2 text-[13px] leading-relaxed text-muted-text">
            {paper.abstract}
          </span>
        )}
        <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-text">
          <span>{authors || "Unknown authors"}{extraAuthors}</span>
          <span aria-hidden="true">·</span>
          <span>{paper.venue ?? "Venue unavailable"}</span>
          <span aria-hidden="true">·</span>
          <span>{paper.date ?? paper.year ?? "Date unavailable"}</span>
          <span aria-hidden="true">·</span>
          <span>{paper.citationCount ?? 0} citations</span>
        </span>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {sources.map((source) => (
            <span key={source} className="rounded-pill bg-card-surface px-2.5 py-1 text-[11px] text-secondary-dark">
              {SOURCE_LABELS[source] ?? source}
            </span>
          ))}
          <IdBadges ids={paper.ids} />
        </div>
      </div>
    </button>
  )
}
