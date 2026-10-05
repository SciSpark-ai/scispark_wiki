import type { PaperRecord } from "@/lib/papers/types"
import { displayTitle } from "@/lib/papers/title"
import { venueYearLine } from "@/lib/papers/venue"
import { IdBadges } from "@/components/papers/IdBadges"

/** Full-page paper header (discovery/saved/ingested alike): title, authors,
 * venue, year, citations and identifiers. The reading column owns the abstract. */
export function PaperHeader({ paper }: { paper: PaperRecord }) {
  const authorLine = paper.authors.map((a) => a.name).join(", ") || "Unknown authors"
  const metaLine = venueYearLine(paper.venue, paper.year)

  return (
    <header>
      <div className="max-w-[960px]">
        <h1 className="font-heading text-[30px] leading-[1.2] text-espresso tracking-heading sm:text-[36px] xl:text-[40px] [overflow-wrap:anywhere]">
          {displayTitle(paper.title)}
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-muted-text">{authorLine}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-text [&_span]:[overflow-wrap:anywhere] [&>div]:min-w-0">
        {metaLine && <span>{metaLine}</span>}
        {typeof paper.citationCount === "number" && <span>{paper.citationCount.toLocaleString()} citations</span>}
        <IdBadges ids={paper.ids} />
      </div>

    </header>
  )
}
