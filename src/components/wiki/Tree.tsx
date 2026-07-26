"use client"

import Link from "next/link"
import { displayTitle } from "@/lib/papers/title"
import type { Bundle } from "@/lib/vault/bundle"
import { PAGE_TYPES } from "@/lib/vault/types"
import { wikiHref } from "@/lib/wiki/href"

// Mirrors index-builder.ts's TYPE_HEADINGS (kept in sync manually, same as
// schema-routing.ts mirrors scaffold.ts's TYPE_DIRS elsewhere in this repo).
const TYPE_HEADINGS: Record<string, string> = {
  paper: "Papers", concept: "Concepts", method: "Methods", finding: "Findings",
  comparison: "Comparisons", author: "Authors", topic: "Topics", note: "Notes",
  query: "Saved answers", idea: "Ideas", project: "Projects",
}

interface TreeProps {
  bundle: Bundle
}

/** Bundle ids are `wiki/papers/<slug>`; the last segment is the slug the
 * unified /paper/<key> page addresses by (mirrors dashboard.ts's slugOf /
 * RecentStrip's paperSlugFromId). */
function paperSlug(id: string): string {
  const segments = id.split("/")
  return segments[segments.length - 1]
}

/** Papers route to the unified paper page instead of the wiki editor; every
 * other type keeps its wikiHref. Scoped to Tree only — the inbox/backlinks
 * surfaces that also call wikiHref directly stay untouched. */
function hrefFor(type: string, id: string): string {
  return type === "paper" ? `/paper/${paperSlug(id)}` : wikiHref(id)
}

export function Tree({ bundle }: TreeProps) {
  const byType = new Map<string, Array<{ id: string; title: string }>>()
  for (const page of bundle.pages.values()) {
    const rows = byType.get(page.frontmatter.type) ?? []
    rows.push({ id: page.id, title: page.frontmatter.title })
    byType.set(page.frontmatter.type, rows)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {PAGE_TYPES.map((type) => {
        const rows = (byType.get(type) ?? []).sort((a, b) => a.title.localeCompare(b.title))
        return (
          <section key={type} className="border border-border-warm rounded-card p-3 bg-light-surface">
            <h2 className="text-[13px] font-medium text-espresso tracking-body mb-2">
              {TYPE_HEADINGS[type] ?? type} <span className="text-muted-text">({rows.length})</span>
            </h2>
            {rows.length === 0 ? (
              <p className="text-[12px] text-muted-text">None yet</p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={hrefFor(type, row.id)}
                      className="text-[13px] text-orange hover:underline truncate block"
                    >
                      {displayTitle(String(row.title ?? ""))}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
