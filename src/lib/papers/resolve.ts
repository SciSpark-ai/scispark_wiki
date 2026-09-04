import type { VaultStorage } from "../vault/storage"
import type { Frontmatter } from "../vault/types"
import { loadFeed } from "../skills/feed"
import { loadBundle } from "../vault/bundle"
import { readReaderHandoff, readReaderHandoffBySlug } from "../reader/handoff"
import { loadTrendingPaperRecords } from "../trending/cache"
import { paperSlug } from "../wiki/authoring"
import { paperKey, type PaperRecord } from "./types"

/**
 * Pulls the text under a `## Abstract` heading (up to the next `## `-level
 * heading, or EOF) out of a paper page body — trimmed, `undefined` when the
 * section is absent or empty. A paper page's abstract lives ONLY in the body
 * (see `buildPaperPage` in `src/lib/wiki/authoring.ts`), never in
 * frontmatter, so callers that reconstruct a `PaperRecord` from a page (e.g.
 * `/api/skills/enrich`) must backfill `abstract` from here or the enrich
 * skill sees "Abstract: (none)" every time. Matches the exact heading level
 * `buildPaperPage` writes (`## Abstract`) so a `### Abstract` sub-heading or
 * an inline "abstract" mention can't be mistaken for the section.
 */
export function extractAbstractFromBody(body: string): string | undefined {
  const lines = body.split("\n")
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Abstract\s*$/i.test(lines[i])) {
      start = i + 1
      break
    }
  }
  if (start === -1) return undefined
  const collected: string[] = []
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break
    collected.push(lines[i])
  }
  const text = collected.join("\n").trim()
  return text === "" ? undefined : text
}

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
 * for `acquireFullText`), then the derived trending cache, then every ingested
 * paper page's frontmatter
 * (works because its `sources/` snapshot serves the reader without any URLs
 * — see `paperRecordFromFrontmatter`'s doc comment). `matches` decides
 * identity — `resolvePaperByKey`/`resolvePaperBySlug` differ only in which
 * derived string they compare. Returns `null` on no match or any failure
 * (missing/corrupt cache or bundle) — best-effort, same as before. Each source
 * is isolated so one corrupt cache cannot prevent a valid later source from
 * resolving the paper.
 */
async function findPaperCandidate(
  storage: VaultStorage,
  matches: (candidate: PaperRecord) => boolean,
): Promise<PaperRecord | null> {
  try {
    const feed = await loadFeed(storage)
    const feedItem = feed?.items.find((it) => matches(it.paper))
    if (feedItem) return feedItem.paper
  } catch {
    // Continue to the independent trending/wiki sources.
  }

  try {
    const trending = await loadTrendingPaperRecords(storage)
    const trendingPaper = trending.find(matches)
    if (trendingPaper) return trendingPaper
  } catch {
    // Continue to the independent wiki source.
  }

  try {
    const bundle = await loadBundle(storage)
    for (const page of bundle.pages.values()) {
      if (page.frontmatter.type !== "paper") continue
      const candidate = paperRecordFromFrontmatter(page.frontmatter)
      if (matches(candidate)) return candidate
    }
  } catch {
    // Best-effort resolution — a missing/corrupt bundle falls through.
  }
  return null
}

/**
 * Resolves the `PaperRecord` for `?paperKey=`: the shared candidate scan
 * (feed cache → trending cache → ingested wiki paper pages) matched by
 * `paperKey`, falling
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
 * candidate scan matched by `paperSlug` instead of `paperKey`, falling back
 * to a reader handoff — a paper reached via the /papers search box stashes
 * its full record there (addressable by both `paperKey` and `paperSlug`, see
 * `writeReaderHandoff`) before navigating to `/paper/<slug>`, since a fresh
 * search result exists in neither the feed cache nor the wiki yet. `null`
 * when nothing resolves.
 */
export async function resolvePaperBySlug(storage: VaultStorage, slug: string): Promise<PaperRecord | null> {
  const candidate = await findPaperCandidate(storage, (c) => paperSlug(c) === slug)
  if (candidate) return candidate
  try {
    const handoff = await readReaderHandoffBySlug(storage, slug)
    if (handoff) return handoff
  } catch {
    // Best-effort, same as the candidate scan above.
  }
  return null
}
