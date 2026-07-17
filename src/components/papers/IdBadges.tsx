import type { PaperIds } from "@/lib/papers/types"

/** Renders one small pill per known id on a paper record (doi, arxiv, pmid). */
export function IdBadges({ ids }: { ids: PaperIds }) {
  const entries: Array<[string, string]> = []
  if (ids.doi) entries.push(["doi", ids.doi])
  if (ids.arxiv) entries.push(["arxiv", ids.arxiv])
  if (ids.pmid) entries.push(["pmid", ids.pmid])

  if (entries.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([kind, value]) => (
        <span
          key={kind}
          className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text"
        >
          {kind}:{value}
        </span>
      ))}
    </div>
  )
}
