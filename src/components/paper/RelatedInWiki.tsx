import Link from "next/link"
import { resolveLink, type Bundle } from "@/lib/vault/bundle"
import { wikiHref } from "@/lib/wiki/href"
import { Card } from "@/components/ui/Card"

export interface RelatedPageLink {
  id: string
  title: string
}

/**
 * Pure: resolves each `frontmatter.related` entry — a BARE slug, e.g. "x"
 * for "wiki/methods/x" (I1, whole-branch review; see
 * `buildEnrichMergeChangeset`'s `bareSlug` helper) — to its real page (id +
 * title) via `resolveLink`, the same suffix-matching resolution the
 * knowledge graph's own `related[]` handling uses (src/lib/viz/graph.ts's
 * `neighborSets`), in `related`'s own order. A slug that no longer resolves
 * (page deleted/merged since the paper was enriched, or ambiguous) is
 * silently dropped rather than shown raw — the UI must never surface a bare
 * slug as a link label.
 */
export function resolveRelatedPages(bundle: Bundle, related: string[] | undefined): RelatedPageLink[] {
  if (!related || related.length === 0) return []
  const out: RelatedPageLink[] = []
  for (const slug of related) {
    const page = resolveLink(bundle, slug)
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
            <Link href={wikiHref(r.id)} className="text-[13px] text-orange hover:text-orange-light transition-colors">
              {r.title}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
