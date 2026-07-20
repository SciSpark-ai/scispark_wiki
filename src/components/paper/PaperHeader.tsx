import type { PaperRecord } from "@/lib/papers/types"
import { displayTitle } from "@/lib/papers/title"
import { venueYearLine } from "@/lib/papers/venue"
import { PageHeader } from "@/components/ui/PageHeader"
import { Card } from "@/components/ui/Card"
import { IdBadges } from "@/components/papers/IdBadges"

/** Full-page paper header (discovery/saved/ingested alike): title, authors,
 * venue·year·citations, id badges, and the abstract in its own card. */
export function PaperHeader({ paper }: { paper: PaperRecord }) {
  const authorLine = paper.authors.map((a) => a.name).join(", ") || "Unknown authors"
  const metaLine = venueYearLine(paper.venue, paper.year)

  return (
    <div>
      <PageHeader title={displayTitle(paper.title)} description={authorLine} />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px] text-muted-text tracking-body">
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
    </div>
  )
}
