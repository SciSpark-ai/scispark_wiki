import type { VaultStorage } from "../vault/storage"
import type { Frontmatter } from "../vault/types"
import { loadFeed } from "../skills/feed"
import { loadBundle } from "../vault/bundle"
import { readReaderHandoff } from "../reader/handoff"
import { paperSlug } from "../wiki/authoring"
import { paperKey, type PaperRecord } from "./types"

/**
 * Reconstructs a minimal `PaperRecord` from an ingested paper page's
 * frontmatter (ids + title + authors + year/venue) — enough for
 * `paperKey`/`loadReaderContent`'s snapshot-hit path (an ingested paper
 * already has `sources/<key>.html` snapshotted, so no htmlUrl/oaUrl/pdfUrl is
 * needed to serve it). `source` is a best-effort guess from whichever id is
 * present; it's never used by `loadReaderContent`/`acquireFullText` for a
 * page reconstructed this way since the snapshot always exists first.
 */
/** Exported (SP2 Task 5) so `/api/skills/enrich` can rebuild a `PaperRecord`
 * from a paper page's frontmatter without duplicating this logic. */
export function paperRecordFromFrontmatter(fm: Frontmatter): PaperRecord {
  const doi = typeof fm.doi === "string" ? fm.doi : undefined
  const arxiv = typeof fm.arxiv === "string" ? fm.arxiv : undefined
  const openalex = typeof fm.openalex === "string" ? fm.openalex : undefined
  const pmid = typeof fm.pmid === "string" ? fm.pmid : undefined

  const authors = Array.isArray(fm.authors)
    ? (fm.authors as unknown[]).filter((a): a is string => typeof a === "string").map((name) => ({ name }))
    : []

  return {
    ids: { doi, arxiv, openalex, pmid },
    title: typeof fm.title === "string" ? fm.title : "Untitled",
    authors,
    year: typeof fm.year === "number" ? fm.year : undefined,
    venue: typeof fm.venue === "string" ? fm.venue : undefined,
    fields: [],
    source: arxiv ? "arxiv" : pmid ? "pubmed" : openalex ? "openalex" : "s2",
  }
}

/**
 * Shared candidate scan: the M5 feed cache first (has htmlUrl/oaUrl/pdfUrl
 * for `acquireFullText`), then every ingested paper page's frontmatter
 * (works because its `sources/` snapshot serves the reader without any URLs
 * — see `paperRecordFromFrontmatter`'s doc comment). `matches` decides
 * identity — `resolvePaperByKey`/`resolvePaperBySlug` differ only in which
 * derived string they compare. Returns `null` on no match or any failure
 * (missing/corrupt cache or bundle) — best-effort, same as before.
 */
async function findPaperCandidate(
  storage: VaultStorage,
  matches: (candidate: PaperRecord) => boolean,
): Promise<PaperRecord | null> {
  try {
    const feed = await loadFeed(storage)
    const feedItem = feed?.items.find((it) => matches(it.paper))
    if (feedItem) return feedItem.paper

    const bundle = await loadBundle(storage)
    for (const page of bundle.pages.values()) {
      if (page.frontmatter.type !== "paper") continue
      const candidate = paperRecordFromFrontmatter(page.frontmatter)
      if (matches(candidate)) return candidate
    }
  } catch {
    // Best-effort resolution — a missing/corrupt cache or bundle just falls
    // through to "not found".
  }
  return null
}

/**
 * Resolves the `PaperRecord` for `?paperKey=`: the shared candidate scan
 * (feed cache → ingested wiki paper pages) matched by `paperKey`, falling
 * back to a reader handoff — a paper reached via the /papers search box
 * stashes its full record there (keyed by `paperKey`) when the user clicks
 * "Read full paper", before it exists anywhere else. `null` when nothing
 * resolves.
 */
export async function resolvePaperByKey(storage: VaultStorage, key: string): Promise<PaperRecord | null> {
  const candidate = await findPaperCandidate(storage, (c) => paperKey(c) === key)
  if (candidate) return candidate
  try {
    const handoff = await readReaderHandoff(storage, key)
    if (handoff) return handoff
  } catch {
    // Best-effort, same as the candidate scan above.
  }
  return null
}

/**
 * Resolves a `PaperRecord` from its sanitized slug (`paperSlug` — the same
 * stem an ingested paper's wiki page filename is built from): the shared
 * candidate scan matched by `paperSlug` instead of `paperKey`. No reader-
 * handoff fallback here — that stash is keyed by `paperKey` (a different,
 * unrelated address space from a slug), so there's no handoff file a slug
 * could look up directly; every existing handoff caller already resolves by
 * key via `resolvePaperByKey`. `null` when nothing resolves.
 */
export async function resolvePaperBySlug(storage: VaultStorage, slug: string): Promise<PaperRecord | null> {
  return findPaperCandidate(storage, (c) => paperSlug(c) === slug)
}
