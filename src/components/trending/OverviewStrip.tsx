import { Card } from "@/components/ui/Card"
import type { BoardOverview } from "@/lib/trending/types"
import { trendingWindowLabels } from "@/lib/trending/topics"

/** Same null-means-"new" rule as TopicRow's growth badge — see that file's doc comment. */
function growthLabel(growth: number | null): string {
  if (growth === null) return "new"
  const pct = Math.round(growth * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

/**
 * Three headline figures for the board. `totalRecent` is a cross-anchor sum
 * that can double-count a work matching two anchor disciplines (see
 * `BoardOverview.totalRecent`'s JSDoc) — the label is phrased as an
 * approximate count across the user's disciplines, never as an exact
 * deduplicated total.
 */
export function OverviewStrip({ overview, generatedAt }: { overview: BoardOverview; generatedAt?: string }) {
  const recentWindow = trendingWindowLabels(generatedAt ?? "").recent
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card className="p-3">
        <div className="font-heading text-[22px] text-espresso tracking-heading-card">{overview.totalRecent}</div>
        <div className="text-[12px] text-muted-text tracking-body">
          papers published across your disciplines from {recentWindow}
        </div>
      </Card>
      <Card className="p-3">
        <div className="font-heading text-[16px] text-espresso tracking-heading-card truncate">
          {overview.topTopicLabel ?? "—"}
        </div>
        <div className="text-[12px] text-muted-text tracking-body">
          top topic <span className="text-orange">{growthLabel(overview.topTopicGrowth)}</span>
        </div>
      </Card>
      <Card className="p-3">
        <div className="font-heading text-[22px] text-espresso tracking-heading-card">{overview.relevantCount}</div>
        <div className="text-[12px] text-muted-text tracking-body">relevant to you</div>
      </Card>
    </div>
  )
}
