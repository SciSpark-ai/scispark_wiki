import Link from "next/link"
import { Chip } from "@/components/ui/Chip"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"

export interface CitationChipsProps {
  /** FULL bundle ids (e.g. "wiki/papers/x"), the shape `ChatMessage.citedPageIds`
   * carries — see the SP5 Task 6 doc comment on that field. */
  pageIds: string[]
  pageTitleById: Record<string, string>
}

/** Bundle ids are `wiki/<dir>/<slug>`; the last segment is the routable slug
 * (mirrors Tree.tsx's paperSlug / RecentStrip.tsx's paperSlugFromId /
 * dashboard.ts's slugOf). */
function lastSegment(id: string): string {
  const segments = id.split("/")
  return segments[segments.length - 1]
}

/**
 * Papers route to the unified /paper/<slug> page; every other type keeps its
 * wikiHref. This component only has ids to go on (no page-type field), so —
 * same as every other id-only renderer in this repo (Tree, RecentStrip,
 * dashboard.ts) — it reads the type off the fixed "wiki/papers/" prefix the
 * default schema routing writes papers under.
 */
function hrefForCitation(id: string): string {
  return id.startsWith("wiki/papers/") ? `/paper/${lastSegment(id)}` : wikiHref(id)
}

function labelFor(id: string, pageTitleById: Record<string, string>): string {
  const title = pageTitleById[id]
  return title ? displayTitle(title) : lastSegment(id)
}

/**
 * Chip row linking each cited page id to its page. An id with no known title
 * (e.g. the wiki index passed down is stale, or the page was renamed) still
 * renders — labeled by its slug — rather than silently dropping the citation.
 */
export function CitationChips({ pageIds, pageTitleById }: CitationChipsProps) {
  if (pageIds.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {pageIds.map((id) => (
        <Link key={id} href={hrefForCitation(id)}>
          <Chip tone="accent" className="hover:bg-orange/20">
            {labelFor(id, pageTitleById)}
          </Chip>
        </Link>
      ))}
    </div>
  )
}
