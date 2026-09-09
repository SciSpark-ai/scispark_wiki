import Link from "next/link"
import { Card } from "@/components/ui/Card"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"
import type { DashboardSection } from "@/lib/wiki/dashboard"

export interface TypeSectionsProps {
  sections: DashboardSection[]
}

/**
 * A grid of per-type section cards (concepts, methods, findings, ideas, …).
 * Idea entries carry status/depth badges — same pattern as the Spark idea
 * gallery and the wiki Tree. Renders nothing for an empty section list so
 * callers can render it unconditionally.
 */
export function TypeSections({ sections }: TypeSectionsProps) {
  if (sections.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((section) => (
        <Card key={section.type} className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-medium text-espresso tracking-body">
              {section.label} <span className="text-muted-text">({section.total})</span>
            </h2>
            <Link href="/wiki?view=all" className="shrink-0 text-[12px] text-accent-ink hover:underline">
              All →
            </Link>
          </div>
          <ul className="space-y-1.5">
            {section.entries.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={wikiHref(entry.id)}
                  className="block truncate text-[13px] text-espresso hover:text-accent-ink"
                >
                  {displayTitle(entry.title)}
                </Link>
                {section.type === "idea" && (entry.status || entry.depth) && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {entry.status && (
                      <span className="rounded-pill bg-card-surface px-2 py-0.5 text-[11px] uppercase tracking-wide text-espresso">
                        {entry.status}
                      </span>
                    )}
                    {entry.depth && (
                      <span className="rounded-pill border border-border-warm bg-light-surface px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-text">
                        {entry.depth}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
