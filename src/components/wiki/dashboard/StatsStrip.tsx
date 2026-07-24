import Link from "next/link"
import { Card } from "@/components/ui/Card"
import type { WikiStats } from "@/lib/wiki/dashboard"

export interface StatsStripProps {
  stats: WikiStats
  inboxCount: number
}

/**
 * Five at-a-glance counts across the top of the wiki dashboard: papers,
 * knowledge (concept+method+finding+comparison+topic), ideas, notes, and a
 * review-inbox count linking through to the review queue.
 */
export function StatsStrip({ stats, inboxCount }: StatsStripProps) {
  const cards = [
    { label: "Papers", value: stats.papers.total },
    { label: "Knowledge", value: stats.knowledge },
    { label: "Ideas", value: stats.ideas },
    { label: "Notes", value: stats.notes },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {cards.map((card) => (
        <Card key={card.label} className="px-4 py-3">
          <div className="font-heading text-[22px] text-espresso tracking-heading-card">{card.value}</div>
          <div className="text-[12px] text-muted-text tracking-body">{card.label}</div>
        </Card>
      ))}
      <Link href="/wiki/inbox" className="block">
        <Card className="px-4 py-3 hover:bg-card-surface/50 transition-colors">
          <div className="font-heading text-[22px] text-espresso tracking-heading-card">{inboxCount}</div>
          <div className="text-[12px] text-muted-text tracking-body">Review inbox</div>
        </Card>
      </Link>
    </div>
  )
}
