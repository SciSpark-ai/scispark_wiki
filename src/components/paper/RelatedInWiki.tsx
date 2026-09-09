import Link from "next/link"
import { resolveLink, type Bundle } from "@/lib/vault/bundle"
import { wikiHref } from "@/lib/wiki/href"
import { Card } from "@/components/ui/Card"
import type { WikiPage } from "@/lib/vault/types"

export interface RelatedPageLink {
  id: string
  title: string
}

/**
 * Pure: resolves each `frontmatter.related` entry to its real page (id +
 * title) in `related`'s own order. Handles BOTH:
 * - BARE slugs (new format): "x" → resolved via suffix match (I1, Enrich now
 *   writes these via `buildEnrichMergeChangeset`'s `bareSlug` helper)
 * - STALE full-id entries (legacy): "wiki/methods/x" → direct lookup (vaults
 *   where Enrich ran before this fix still have these on disk)
 *
 * Resolution: for each entry, first try direct full-id lookup
 * (bundle.pages.get), then fall back to bareSlug resolution (resolveLink).
 * An entry that no longer resolves is silently dropped — the UI must never
 * surface a raw slug as a link label. See resolveLink for the same
 * suffix-matching resolution the knowledge graph's own `related[]` handling
 * uses (src/lib/viz/graph.ts's `neighborSets`).
 */
export function resolveRelatedPages(bundle: Bundle, related: string[] | undefined): RelatedPageLink[] {
  if (!related || related.length === 0) return []
  const out: RelatedPageLink[] = []
  for (const entry of related) {
    // Try direct full-id lookup first (handles stale full-id format)
    let page: WikiPage | null = bundle.pages.get(entry) ?? null
    // Fall back to bare-slug resolution (handles new format and path-qualified slugs)
    if (!page) {
      page = resolveLink(bundle, entry)
    }
    if (!page) continue
    out.push({ id: page.id, title: page.frontmatter.title })
  }
  return out
}

/** "Related in your knowledge base" — links (via `wikiHref`) to every wiki
 * page this saved paper relates to, resolved title first. Renders nothing
 * when empty so the caller can render it unconditionally. */
export function RelatedInWiki({ related }: { related: RelatedPageLink[] }) {
  if (related.length === 0) return null

  return (
    <Card className="mt-4 p-5">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-text">Related in your knowledge base</div>
      <ul className="space-y-1">
        {related.map((r) => (
          <li key={r.id}>
            <Link href={wikiHref(r.id)} className="text-[13px] text-accent-ink hover:text-accent-ink-hover transition-colors">
              {r.title}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
