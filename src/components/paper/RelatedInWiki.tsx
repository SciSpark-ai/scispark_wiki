import Link from "next/link"
import type { Bundle } from "@/lib/vault/bundle"
import { wikiHref } from "@/lib/wiki/href"
import { Card } from "@/components/ui/Card"

export interface RelatedPageLink {
  id: string
  title: string
}

/**
 * Pure: resolves each `frontmatter.related` page id (full bundle ids, e.g.
 * "wiki/methods/x" — see `buildEnrichMergeChangeset`) to its title from the
 * bundle, in `related`'s own order. An id that no longer resolves (page
 * deleted/merged since the paper was enriched) is silently dropped rather
 * than shown raw — the UI must never surface a bare vault path as a link
 * label.
 */
export function resolveRelatedPages(bundle: Bundle, related: string[] | undefined): RelatedPageLink[] {
  if (!related || related.length === 0) return []
  const out: RelatedPageLink[] = []
  for (const id of related) {
    const page = bundle.pages.get(id)
    if (!page) continue
    out.push({ id, title: page.frontmatter.title })
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
            <Link href={wikiHref(r.id)} className="text-[13px] text-orange hover:text-orange-light transition-colors">
              {r.title}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
