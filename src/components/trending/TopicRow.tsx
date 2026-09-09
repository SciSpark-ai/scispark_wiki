"use client"

import Link from "next/link"
import { ChevronDown, ArrowUpRight } from "lucide-react"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"
import { paperSlug } from "@/lib/wiki/authoring"
import type { BoardTopic } from "@/lib/trending/types"
import { TrendBars } from "./TrendBars"

/**
 * The change in the topic's SHARE of its discipline, not in its raw paper
 * count (OpenAlex under-indexes the recent window for every topic alike, which
 * raw counts would read as a board-wide decline). The bars beside this badge
 * are drawn from the same two shares, so the two can never disagree.
 *
 * `growth: null` means "no prior-window activity to compare against" — the
 * COMMON case for a freshly-heating topic, not an edge case. It renders the
 * literal word "new", never `∞`/`NaN%`/an em dash (the em dash is reserved
 * for a null topTopicLabel elsewhere, i.e. an empty board).
 */
function GrowthBadge({ growth }: { growth: number | null }) {
  if (growth === null) {
    return (
      <span className="text-[15px] font-medium text-orange">
        new
      </span>
    )
  }
  const pct = Math.round(growth * 100)
  const positive = pct >= 0
  return (
    <span
      className={
        positive
          ? "text-[15px] font-medium tabular-nums text-orange"
          : "text-[15px] font-medium tabular-nums text-secondary-dark"
      }
    >
      {positive ? `+${pct.toLocaleString("en-US")}%` : `${pct.toLocaleString("en-US")}%`}
    </span>
  )
}

export interface TopicRowProps {
  topic: BoardTopic
  rank: number
  expanded: boolean
  onToggle: () => void
  recentWindowLabel?: string
  priorWindowLabel?: string
}

/** A readable topic row; details keep the comparison and its papers together. */
export function TopicRow({
  topic,
  rank,
  expanded,
  onToggle,
  recentWindowLabel = "the latest complete two-week period",
  priorWindowLabel = "the preceding complete two-week period",
}: TopicRowProps) {
  return (
    <div className="border-b border-border-warm last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`topic-${encodeURIComponent(topic.key)}`}
        onClick={onToggle}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-4 gap-y-3 px-4 py-4 text-left transition-colors hover:bg-card-surface/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orange md:grid-cols-[minmax(0,1fr)_4.5rem_6rem_1rem] md:px-5"
      >
        <span className="col-span-2 min-w-0 md:col-span-1">
          <span className="sr-only">Rank {rank}. </span>
          <span className="block text-pretty text-[15px] font-medium leading-relaxed text-espresso">{topic.label}</span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-relaxed text-secondary-dark">
            <span>{topic.discipline}</span>
            {topic.relevant && <span className="text-orange">Matches your interests</span>}
          </span>
        </span>
        <span className="col-start-1 row-start-2 flex items-baseline gap-1.5 text-[14px] tabular-nums text-secondary-dark md:col-start-auto md:row-start-auto md:block md:text-right">
          <span className="sr-only">Papers in this publication window: </span>{topic.recentCount.toLocaleString("en-US")}
          <span className="text-[12px] md:hidden">papers</span>
        </span>
        <span className="col-start-2 row-start-2 text-right md:col-start-auto md:row-start-auto">
          <span className="sr-only">Share growth: </span><GrowthBadge growth={topic.growth} />
          <span className="ml-1.5 text-[12px] text-secondary-dark md:hidden">share</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={`col-start-3 row-start-1 text-muted-text md:col-start-auto md:row-start-auto ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div id={`topic-${encodeURIComponent(topic.key)}`} className="border-t border-border-warm bg-page-bg p-4 md:p-5">
          {/* Absolute volume in words: the badge and bars are both share-based,
              so the honest raw counts live here rather than being drawn. */}
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <TrendBars priorShare={topic.priorShare} recentShare={topic.recentShare} priorCount={topic.priorCount} recentCount={topic.recentCount} priorWindowLabel={priorWindowLabel} recentWindowLabel={recentWindowLabel} />
            <div className="text-[12px] leading-relaxed text-secondary-dark">
              <p><span className="font-medium text-espresso">Share of publications:</span> {topic.growth === null ? "earlier share not reliable" : `${formatShare(topic.priorShare)} before`} → {formatShare(topic.recentShare)} now</p>
              <p>{topic.recentCount} papers from {recentWindowLabel} · {topic.priorCount} from {priorWindowLabel}</p>
              {topic.growth === null && <p>Earlier activity is too limited for a reliable growth comparison.</p>}
            </div>
          </div>
          {topic.why !== null ? (
            <p className="text-pretty text-[14px] leading-relaxed text-secondary-dark">{topic.why}</p>
          ) : (
            <p className="text-[13px] leading-relaxed text-muted-text">
              A written summary is unavailable for this topic right now.
            </p>
          )}
          {topic.papers.length > 0 && (
            <ul aria-label="Papers in this topic" className="mt-4 divide-y divide-border-warm">
              {topic.papers.map((p) => (
                <li key={paperSlug(p.record)} className="flex items-start gap-3 py-3 text-[13px]">
                  <Link href={`/paper/${paperSlug(p.record)}`} className="flex min-w-0 flex-1 items-start justify-between gap-3 rounded leading-relaxed text-espresso hover:text-orange focus-visible:outline-2 focus-visible:outline-orange">
                    <span>{displayTitle(p.record.title)}</span><ArrowUpRight size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                  </Link>
                  {p.wikiPageId !== null && (
                    <Link href={wikiHref(p.wikiPageId)} className="shrink-0 text-muted-text hover:text-orange">
                      In Wiki
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {topic.papers.length === 0 && <p className="mt-3 text-[13px] text-muted-text">No representative papers were included in this update.</p>}
        </div>
      )}
    </div>
  )
}

function formatShare(share: number): string {
  return `${(Number.isFinite(share) && share > 0 ? share * 100 : 0).toFixed(2)}%`
}
