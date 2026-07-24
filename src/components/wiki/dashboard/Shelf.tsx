"use client"

import Link from "next/link"
import { Card } from "@/components/ui/Card"
import { Chip } from "@/components/ui/Chip"
import { Button } from "@/components/ui/Button"
import { displayTitle } from "@/lib/papers/title"
import type { ShelfEntry } from "@/lib/wiki/dashboard"

export interface ShelfProps {
  label: string
  entries: ShelfEntry[]
  total: number
  onViewAll: () => void
}

/**
 * A horizontally-scrolling row of paper cards for one status bucket
 * (saved/enriched/ingested). Renders nothing when there are no entries so
 * callers can render every shelf unconditionally. A trailing "View all"
 * control appears only when the bucket holds more than what's shown.
 */
export function Shelf({ label, entries, total, onViewAll }: ShelfProps) {
  if (entries.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-medium text-espresso tracking-body">
        {label} <span className="text-muted-text">({total})</span>
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {entries.map((entry) => (
          <Link key={entry.id} href={`/paper/${entry.slug}`} className="block w-64 shrink-0">
            <Card className="flex h-full flex-col gap-2 p-3 hover:bg-card-surface/50 transition-colors">
              <div className="font-heading text-[14px] text-espresso tracking-heading-card leading-snug line-clamp-2">
                {displayTitle(entry.title)}
              </div>
              {entry.tldr && (
                <p className="text-[12px] leading-[1.5] text-muted-text tracking-body line-clamp-2">{entry.tldr}</p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                <span className="rounded-pill bg-card-surface px-2 py-0.5 text-[11px] uppercase tracking-wide text-espresso">
                  {entry.status}
                </span>
                {entry.tags.slice(0, 3).map((tag) => (
                  <Chip key={tag}>{tag}</Chip>
                ))}
              </div>
            </Card>
          </Link>
        ))}
        {total > entries.length && (
          <div className="flex shrink-0 items-center">
            <Button variant="secondary" size="sm" onClick={onViewAll}>
              View all ({total})
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
