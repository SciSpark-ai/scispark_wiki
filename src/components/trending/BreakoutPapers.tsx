import Link from "next/link"
import { Card } from "@/components/ui/Card"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"
import { paperSlug } from "@/lib/wiki/authoring"
import type { TrendingBoard } from "@/lib/trending/dashboard"

export interface BreakoutPapersProps {
  breakouts: TrendingBoard["breakouts"]
}

/** A compact secondary strip: recent papers with unusual citation counts. Renders nothing when there are none — an empty strip is an honest, expected outcome (see dashboard.ts's `retrieveBreakouts` doc comment). */
export function BreakoutPapers({ breakouts }: BreakoutPapersProps) {
  if (breakouts.length === 0) return null

  return (
    <Card className="p-3">
      <h2 className="mb-2 text-[13px] font-medium text-espresso tracking-body">Breakout papers</h2>
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
