import type { Bundle } from "../vault/bundle"
import type { VaultStorage } from "../vault/storage"
import type { Frontmatter } from "../vault/types"
import type { CitationRef } from "../papers/citations-core"
import { paperKey, type PaperIds, type PaperRecord } from "../papers/types"
import { paperSlug } from "../wiki/authoring"

// App-owned local cache of S2 reference lists, one file per vault paper —
// same rationale/shape as the M4 digest cache (.scispark/digests/): raw
// upstream metadata that feeds derivation but is not itself a derived view
// (design 02's "derived views are never stored" applies to KnowledgeGraph/
// Timeline/AuthorNetwork/CitationFlow, not to this cache).
export const CITATIONS_DIR = ".scispark/citations"

export interface CitationEdge {
  citing: string // bundle page id
  cited: string // bundle page id
}

export interface CitationFlow {
  edges: CitationEdge[]
  papersWithData: number
  papersTotal: number
}

interface CitationCacheFile {
  fetchedAt: string
  references: CitationRef[]
}

/**
 * Slug scheme for the citation cache: reconstructs a minimal PaperRecord
 * from a `type: paper` page's frontmatter (doi/arxiv/title only — the only
 * fields `paperSlug` reads) and slugs it with the *same* `paperSlug` used to
 * name the page's own file in `buildPaperPage` (src/lib/wiki/authoring.ts).
 * This is the one consistent scheme for this module: for any page created
 * via the normal ingest path, `paperSlugFromFrontmatter(page.frontmatter)`
 * equals `page.id`'s own last path segment, and — like the digest cache
 * (`.scispark/digests/<paperSlug>.json`) — it stays reproducible even if the
 * page file is later moved to a different schema-routed directory, since it
 * depends only on frontmatter, never on the page's current path.
 */
function paperSlugFromFrontmatter(frontmatter: Frontmatter): string {
  const doi = typeof frontmatter.doi === "string" ? frontmatter.doi : undefined
  const arxiv = typeof frontmatter.arxiv === "string" ? frontmatter.arxiv : undefined
  const title = typeof frontmatter.title === "string" ? frontmatter.title : ""
  const fakePaper: PaperRecord = { ids: { doi, arxiv }, title, authors: [], fields: [], source: "s2" }
  return paperSlug(fakePaper)
}

function citationCachePath(frontmatter: Frontmatter): string {
  return `${CITATIONS_DIR}/${paperSlugFromFrontmatter(frontmatter)}.json`
}

async function readCitationCache(storage: VaultStorage, path: string): Promise<CitationCacheFile | null> {
  const raw = await storage.read(path)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as CitationCacheFile
    if (!Array.isArray(parsed.references)) return null
    return parsed
  } catch {
    return null
  }
}

/** Response envelope shape returned by /api/citations — see citations-core.ts. */
interface CitationsApiEnvelope {
  references?: unknown
}

/**
 * Loads cached S2 reference lists for every `type: paper` page in the vault
 * that has a `doi` or `arxiv` id, keyed by bundle page id. Papers with
 * neither id are skipped entirely (never queried or cached) — they still
 * count toward `deriveCitationFlow`'s `papersTotal`, just never toward
 * `papersWithData`.
 *
 * With `fetchMissing: true`, any eligible paper that has no cache file yet
 * is fetched via `GET /api/citations?id=<DOI:...|ARXIV:...>` (arxiv
 * preferred when both ids are present, matching `paperSlug`'s own
 * precedence) and the result is written to `.scispark/citations/<slug>.json`
 * as `{ fetchedAt, references }` — a direct, app-owned write, same as the
 * M4 digest cache; not an `applyChangeset`.
 *
 * A fetch failure (network throw, non-OK response, or malformed body) for
 * one paper is skipped silently and never included in the returned map —
 * partial citation data across the vault is expected and fine.
 */
export async function loadCitationRefs(
  storage: VaultStorage,
  bundle: Bundle,
  opts: { fetchMissing?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, CitationRef[]>> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const result = new Map<string, CitationRef[]>()

  for (const page of bundle.pages.values()) {
    if (page.frontmatter.type !== "paper") continue

    const doi = typeof page.frontmatter.doi === "string" ? page.frontmatter.doi : undefined
    const arxiv = typeof page.frontmatter.arxiv === "string" ? page.frontmatter.arxiv : undefined
    if (!doi && !arxiv) continue

    const cachePath = citationCachePath(page.frontmatter)
    const cached = await readCitationCache(storage, cachePath)
    if (cached) {
      result.set(page.id, cached.references)
      continue
    }

    if (!opts.fetchMissing) continue

    const externalId = arxiv ? `ARXIV:${arxiv}` : `DOI:${doi}`
    try {
      const res = await fetchImpl(`/api/citations?id=${encodeURIComponent(externalId)}`)
      if (!res.ok) continue
      const body = (await res.json()) as CitationsApiEnvelope
      const references = Array.isArray(body.references) ? (body.references as CitationRef[]) : []
      result.set(page.id, references)
      const cacheFile: CitationCacheFile = { fetchedAt: new Date().toISOString(), references }
      await storage.write(cachePath, JSON.stringify(cacheFile, null, 2))
    } catch {
      // Fetch failures skip silently — partial data across the vault is fine.
    }
  }

  return result
}

/**
 * Computes the `paperKey` variant(s) an id set participates in: a
 * doi-keyed variant when `ids.doi` is present, an arxiv-keyed variant when
 * `ids.arxiv` is present (both, when both ids are present) — reusing
 * `paperKey`'s own normalization (src/lib/papers/types.ts) rather than
 * re-deriving it, same approach M5's `vaultPaperKeys` (src/lib/skills/
 * feed.ts) takes for matching against vault papers. Unlike `paperKey`
 * itself (which picks *one* key by precedence), this returns every variant
 * so a reference citing a vault paper by DOI still matches even when that
 * vault paper's own frontmatter lists only an arxiv id, or vice versa.
 */
function keyVariants(ids: PaperIds): string[] {
  const keys: string[] = []
  if (ids.doi) keys.push(paperKey({ ids: { doi: ids.doi }, title: "", authors: [], fields: [], source: "s2" }))
  if (ids.arxiv) keys.push(paperKey({ ids: { arxiv: ids.arxiv }, title: "", authors: [], fields: [], source: "s2" }))
  return keys
}

/** Maps every doi/arxiv key variant of every vault `type: paper` page to that page's id. */
function vaultPaperIndex(bundle: Bundle): Map<string, string> {
  const index = new Map<string, string>()
  for (const page of bundle.pages.values()) {
    if (page.frontmatter.type !== "paper") continue
    const doi = typeof page.frontmatter.doi === "string" ? page.frontmatter.doi : undefined
    const arxiv = typeof page.frontmatter.arxiv === "string" ? page.frontmatter.arxiv : undefined
    for (const key of keyVariants({ doi, arxiv })) {
      if (!index.has(key)) index.set(key, page.id)
    }
  }
  return index
}

/**
 * Joins cached reference lists against vault papers to derive citation
 * edges. Pure given its inputs — no storage/network/DOM.
 *
 * For every `type: paper` page with an entry in `refsByPageId`, each of its
 * references is matched against `vaultPaperIndex` by doi and/or arxiv key
 * variant; a match produces one `{citing, cited}` edge (deduped; self-edges
 * dropped). References that don't match any vault paper contribute no edge.
 *
 * `papersTotal` is every `type: paper` page in the bundle; `papersWithData`
 * is however many of those have an entry in `refsByPageId` (i.e. citation
 * data was successfully loaded/fetched for them, cached-empty included).
 */
export function deriveCitationFlow(bundle: Bundle, refsByPageId: Map<string, CitationRef[]>): CitationFlow {
  const index = vaultPaperIndex(bundle)
  const paperPages = [...bundle.pages.values()].filter((p) => p.frontmatter.type === "paper")

  const papersTotal = paperPages.length
  const papersWithData = paperPages.filter((p) => refsByPageId.has(p.id)).length

  const seenEdges = new Set<string>()
  const edges: CitationEdge[] = []

  for (const page of paperPages) {
    const refs = refsByPageId.get(page.id)
    if (!refs) continue

    for (const ref of refs) {
      let citedId: string | undefined
      for (const key of keyVariants(ref.ids)) {
        const match = index.get(key)
        if (match) {
          citedId = match
          break
        }
      }
      if (!citedId || citedId === page.id) continue

      const edgeKey = `${page.id} ${citedId}`
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)
      edges.push({ citing: page.id, cited: citedId })
    }
  }

  return { edges, papersWithData, papersTotal }
}
