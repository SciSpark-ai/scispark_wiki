import Link from "next/link"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"
import { paperSlug } from "@/lib/wiki/authoring"
import type { TrendingBoard } from "@/lib/trending/types"
import { completeWindows, formatDateWindow } from "@/lib/trending/topics"

export interface BreakoutPapersProps {
  breakouts: TrendingBoard["breakouts"]
  generatedAt?: string
}

/**
 * A compact secondary strip: the most-cited papers published across the user's
 * anchor disciplines in the last quarter. The window is stated in the subtitle
 * rather than left to the word "breakout" — these are NOT papers from the
 * board's own two-week window, which is far too short for citations to accrue
 * (see dashboard.ts's `retrieveBreakouts`). Renders nothing when there are
 * none — an empty strip stays an honest outcome.
 */
export function BreakoutPapers({ breakouts, generatedAt }: BreakoutPapersProps) {
  if (breakouts.length === 0) return null
  const at = new Date(generatedAt ?? "")
  let publicationWindow: string | null = null
  if (Number.isFinite(at.getTime())) {
    const { toDate } = completeWindows(at).recent
    const fromDate = new Date(new Date(`${toDate}T00:00:00Z`).getTime() - 90 * 86_400_000).toISOString().slice(0, 10)
    publicationWindow = formatDateWindow({ fromDate, toDate })
  }

  return (
    <div>
      <h2 className="font-heading text-[24px] text-espresso tracking-heading-card">Highly cited papers</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-secondary-dark">Across all your selected fields.</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-text">{publicationWindow ? `Published ${publicationWindow}.` : "Published in the board’s 90-day lookback."}</p>
      <ul className="mt-4 divide-y divide-border-warm">
        {breakouts.map((b) => (
          <li key={paperSlug(b.record)} className="py-4 first:pt-0">
            <Link href={`/paper/${paperSlug(b.record)}`} className="block rounded text-[14px] font-medium leading-relaxed text-espresso hover:text-orange focus-visible:outline-2 focus-visible:outline-orange">
              {displayTitle(b.record.title)}
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted-text">
              <span>{b.citationCount.toLocaleString("en-US")} citations</span>
              {b.wikiPageId !== null && (
                <Link href={wikiHref(b.wikiPageId)} className="shrink-0 text-muted-text hover:text-orange">
                  In Wiki
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
