import Link from "next/link"
import { Card } from "@/components/ui/Card"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"
import { paperSlug } from "@/lib/wiki/authoring"
import type { TrendingBoard } from "@/lib/trending/types"

export interface BreakoutPapersProps {
  breakouts: TrendingBoard["breakouts"]
}

/**
 * A compact secondary strip: the most-cited papers published across the user's
 * anchor disciplines in the last quarter. The window is stated in the subtitle
 * rather than left to the word "breakout" — these are NOT papers from the
 * board's own two-week window, which is far too short for citations to accrue
 * (see dashboard.ts's `retrieveBreakouts`). Renders nothing when there are
 * none — an empty strip stays an honest outcome.
 */
export function BreakoutPapers({ breakouts }: BreakoutPapersProps) {
  if (breakouts.length === 0) return null

  return (
    <Card className="p-3">
      <h2 className="text-[13px] font-medium text-espresso tracking-body">Breakout papers</h2>
      <p className="mb-2 text-[11px] text-muted-text tracking-body">Most-cited in your fields over the last 90 days</p>
      <ul className="flex flex-col gap-1.5">
        {breakouts.map((b) => (
          <li key={paperSlug(b.record)} className="flex items-center gap-2 text-[12px] tracking-body">
            <Link href={`/paper/${paperSlug(b.record)}`} className="min-w-0 truncate text-espresso hover:text-orange">
              {displayTitle(b.record.title)}
            </Link>
            <span className="shrink-0 text-muted-text">{b.citationCount} citations</span>
            {b.wikiPageId !== null && (
              <Link href={wikiHref(b.wikiPageId)} className="shrink-0 text-muted-text hover:text-orange">
                wiki
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
