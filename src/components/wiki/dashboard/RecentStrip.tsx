import Link from "next/link"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"
import type { RecentEntry } from "@/lib/wiki/dashboard"

export interface RecentStripProps {
  recent: RecentEntry[]
}

/** Bundle ids are `wiki/papers/<slug>`; the last segment is the slug the
 * paper route addresses by (mirrors dashboard.ts's internal slugOf). */
function paperSlugFromId(id: string): string {
  const segments = id.split("/")
  return segments[segments.length - 1]
}

function hrefFor(entry: RecentEntry): string {
  return entry.type === "paper" ? `/paper/${paperSlugFromId(entry.id)}` : wikiHref(entry.id)
}

/**
 * A recently-updated activity list across the whole wiki. Presentation-only
 * "Updated <title>" rows — no changeset ids or skill names, per the no-dev-
 * language rule for user surfaces. Renders nothing when empty.
 */
export function RecentStrip({ recent }: RecentStripProps) {
  if (recent.length === 0) return null

  return (
    <ul className="space-y-1.5">
      {recent.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-3 text-[13px]">
          <Link href={hrefFor(entry)} className="min-w-0 truncate text-espresso hover:text-accent-ink">
            Updated {displayTitle(entry.title)}
          </Link>
          <span className="shrink-0 text-[12px] text-muted-text tracking-body">{entry.updated}</span>
        </li>
      ))}
    </ul>
  )
}
