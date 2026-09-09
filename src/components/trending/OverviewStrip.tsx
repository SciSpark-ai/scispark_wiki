import type { BoardOverview } from "@/lib/trending/types"
import { trendingWindowLabels } from "@/lib/trending/topics"

/** Board-wide totals stay separate from the locally filtered topic list. */
export function OverviewStrip({ overview, generatedAt }: { overview: BoardOverview; generatedAt?: string }) {
  const windows = trendingWindowLabels(generatedAt ?? "")
  return (
    <section aria-label="Publication overview" className="flex flex-col justify-between gap-3 border-b border-border-warm pb-4 sm:gap-4 sm:pb-6 lg:flex-row lg:items-end">
      <div>
        <p className="text-[13px] text-secondary-dark">Publication window</p>
        <h2 className="mt-1 font-heading text-[24px] leading-tight text-espresso tracking-heading-card">{windows.recent}</h2>
        <p className="mt-2 text-[13px] text-muted-text">Compared with {windows.prior}</p>
      </div>
      <div className="text-[13px] leading-relaxed text-secondary-dark lg:text-right">
        <p><strong className="font-semibold tabular-nums text-espresso">{overview.totalRecent.toLocaleString("en-US")}</strong> papers across all selected fields</p>
        <p className="text-muted-text">{overview.relevantCount} {overview.relevantCount === 1 ? "topic matches" : "topics match"} your interests</p>
      </div>
    </section>
  )
}
