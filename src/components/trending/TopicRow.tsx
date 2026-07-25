"use client"

import Link from "next/link"
import { Chip } from "@/components/ui/Chip"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"
import { paperSlug } from "@/lib/wiki/authoring"
import type { BoardTopic } from "@/lib/trending/dashboard"
import { Sparkline } from "./Sparkline"

/**
 * `growth: null` means "no prior-window activity to compare against" — the
 * COMMON case for a freshly-heating topic, not an edge case. It renders the
 * literal word "new", never `∞`/`NaN%`/an em dash (the em dash is reserved
 * for a null topTopicLabel elsewhere, i.e. an empty board).
 */
function GrowthBadge({ growth }: { growth: number | null }) {
  if (growth === null) {
    return (
      <span className="rounded-pill bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange tracking-body">
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
          ? "rounded-pill bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange tracking-body"
          : "rounded-pill bg-card-surface px-2 py-0.5 text-[11px] font-medium text-muted-text tracking-body"
      }
    >
      {positive ? `+${pct}%` : `${pct}%`}
    </span>
  )
}

export interface TopicRowProps {
  topic: BoardTopic
  rank: number
  expanded: boolean
  onToggle: () => void
}

/** One dense leaderboard row. Expands in place to show the LLM why-brief (or an honest unavailable note) plus representative papers. */
export function TopicRow({ topic, rank, expanded, onToggle }: TopicRowProps) {
  return (
    <div className="border-b border-border-warm last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-card-surface/50 transition-colors"
      >
        <span className="w-5 shrink-0 text-[12px] text-muted-text tracking-body">{rank}</span>
        <GrowthBadge growth={topic.growth} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-espresso tracking-body">{topic.label}</span>
        <Sparkline points={topic.weekly} />
        <Chip>{topic.discipline}</Chip>
        {topic.relevant && (
          <span className="rounded-pill bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange tracking-body">
            Relevant to you
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pl-11">
          {topic.why !== null ? (
            <p className="text-[13px] leading-[1.5] text-muted-text tracking-body">{topic.why}</p>
          ) : (
            <p className="text-[13px] italic leading-[1.5] text-muted-text tracking-body">
              A written summary is unavailable for this topic right now.
            </p>
          )}
          {topic.papers.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {topic.papers.map((p) => (
                <li key={paperSlug(p.record)} className="flex items-center gap-2 text-[12px] tracking-body">
                  <Link href={`/paper/${paperSlug(p.record)}`} className="min-w-0 truncate text-espresso hover:text-orange">
                    {displayTitle(p.record.title)}
                  </Link>
                  {p.wikiPageId !== null && (
                    <Link href={wikiHref(p.wikiPageId)} className="shrink-0 text-muted-text hover:text-orange">
                      wiki
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
