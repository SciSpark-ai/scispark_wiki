"use client"

import Link from "next/link"
import type { Bundle } from "@/lib/vault/bundle"
import { formatGroundingCount } from "@/lib/spark/ui-format"
import { wikiHref } from "@/lib/wiki/href"

interface IdeaGalleryProps {
  bundle: Bundle
}

/**
 * Cards for every `idea`-type page in the wiki (`wiki/ideas/*`) — title,
 * status/depth badges, grounding count — click through to /wiki/<id>.
 * Newest-updated first.
 */
export function IdeaGallery({ bundle }: IdeaGalleryProps) {
  const ideas = [...bundle.pages.values()]
    .filter((p) => p.frontmatter.type === "idea")
    .sort((a, b) => (b.frontmatter.updated ?? "").localeCompare(a.frontmatter.updated ?? ""))

  if (ideas.length === 0) {
    return <p className="text-[13px] text-muted-text tracking-body">No ideas yet — Spark one above.</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {ideas.map((page) => {
        const status = typeof page.frontmatter.status === "string" ? page.frontmatter.status : undefined
        const depth = typeof page.frontmatter.depth === "string" ? page.frontmatter.depth : undefined
        return (
          <Link
            key={page.id}
            href={wikiHref(page.id)}
            className="block border border-border-warm rounded-card px-3 py-2 bg-light-surface hover:bg-card-surface/50 transition-colors"
          >
            <div className="font-heading text-[15px] text-espresso tracking-heading-card truncate">
              {page.frontmatter.title}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {status && (
                <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-espresso">
                  {status}
                </span>
              )}
              {depth && (
                <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-light-surface border border-border-warm text-muted-text">
                  {depth}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[12px] text-muted-text tracking-body">
              {formatGroundingCount(page.frontmatter.related.length)}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
