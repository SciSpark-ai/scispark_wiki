import type { PaperRecord } from "@/lib/papers/types"
import { displayTitle } from "@/lib/papers/title"
import { venueYearLine } from "@/lib/papers/venue"
import { Card } from "@/components/ui/Card"
import { IdBadges } from "@/components/papers/IdBadges"

/** Full-page paper header (discovery/saved/ingested alike): title, authors,
 * venue·year·citations, id badges, and the abstract in its own card. */
export function PaperHeader({ paper }: { paper: PaperRecord }) {
  const authorLine = paper.authors.map((a) => a.name).join(", ") || "Unknown authors"
  const metaLine = venueYearLine(paper.venue, paper.year)

  return (
    <header>
      <div className="mb-7 max-w-[1080px]">
        <h1 className="font-heading text-[34px] leading-[1.12] text-espresso tracking-heading sm:text-[40px] xl:text-[44px]">
          {displayTitle(paper.title)}
        </h1>
        <p className="mt-3 text-[14px] text-muted-text tracking-body">{authorLine}</p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-text tracking-body">
        {metaLine && <span>{metaLine}</span>}
        {typeof paper.citationCount === "number" && <span>{paper.citationCount.toLocaleString()} citations</span>}
        <IdBadges ids={paper.ids} />
      </div>

      {paper.abstract && (
        <Card className="p-5">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-text">Abstract</div>
          <p className="whitespace-pre-wrap text-[14px] leading-[1.7] text-espresso tracking-body">{paper.abstract}</p>
        </Card>
      )}
    </header>
  )
}
