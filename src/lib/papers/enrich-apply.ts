import type { Changeset } from "../vault/types"
import type { EnrichResult } from "../skills/enrich"
import { parseDocument, serializeDocument } from "../vault/frontmatter"
import { makeChangesetId } from "../vault/changesets"

/** Deduped union of `existing` (any non-string entries dropped defensively —
 * frontmatter is `[key: string]: unknown`) with `additions`, preserving the
 * existing order and appending only genuinely new entries. Never drops a
 * human- or ingest-added tag/link. */
function unionStrings(existing: unknown, additions: string[]): string[] {
  const base = Array.isArray(existing) ? existing.filter((v): v is string => typeof v === "string") : []
  const seen = new Set(base)
  const merged = [...base]
  for (const item of additions) {
    if (seen.has(item)) continue
    seen.add(item)
    merged.push(item)
  }
  return merged
}

/**
 * Pure merge (SP2 Task 5): folds an `EnrichResult` into an existing paper
 * page's current content, producing an undoable `Changeset` the route/caller
 * applies via `applyChangeset`. `tldr` is replaced outright (always the
 * freshest one-liner); `tags`/`related` are deduped unions against whatever
 * is already there so a re-enrich never drops a prior tag or link; `status`
 * flips to `"enriched"` (idempotent — re-enriching an already-enriched page
 * just refreshes tldr/tags/related) UNLESS the page is already `"ingested"`,
 * in which case status stays `"ingested"` (never downgraded) while
 * tldr/tags/related still refresh — an ingested page auto-enriched by a
 * later caller must not regress to a lower tier. The body and every other
 * frontmatter key are left exactly as parsed. `before` is `currentContent` verbatim, so
 * `applyChangeset`'s conflict check (which compares `before` against the
 * live file) only succeeds when nothing else wrote the page in between.
 */
export function buildEnrichMergeChangeset(
  pageId: string,
  currentContent: string,
  enrich: EnrichResult,
): Changeset {
  const { frontmatter, body } = parseDocument(currentContent)
  frontmatter.tldr = enrich.tldr
  frontmatter.tags = unionStrings(frontmatter.tags, enrich.tags)
  frontmatter.related = unionStrings(frontmatter.related, enrich.relatedPageIds)
  // Status monotonicity: never downgrade an ingested page to enriched.
  if (frontmatter.status !== "ingested") frontmatter.status = "enriched"
  const after = serializeDocument(frontmatter, body)

  return {
    id: makeChangesetId(),
    skill: "enrich",
    // Mirrors ingest's "tier:<name>" convention (src/lib/skills/ingest.ts): the
    // concrete model behind the `fast` tier is resolved inside the runner and
    // deliberately not threaded through this pure function, so the audit
    // record captures the tier request rather than a guessed model id.
    model: "tier:fast",
    timestamp: new Date().toISOString(),
    changes: [{ path: `${pageId}.md`, before: currentContent, after }],
  }
}
