import type { Bundle } from "../vault/bundle"
import type { WikiPage } from "../vault/types"
import type { PaperStatus } from "../wiki/authoring"

export interface PaperPageState {
  state: "discovery" | "saved" | "ingested"
  status?: PaperStatus
}

/**
 * Finds a paper page by its slug, scanning the bundle for `type === "paper"`
 * pages whose id's final path segment matches `slug` (I2, whole-branch
 * review) — routing-tolerant, so a `schema.md` that routes `paper` to a
 * non-default directory (e.g. `wiki/sources`) still resolves. Mirrors the
 * enrich route's own `findPaperPage` (kept as one shared implementation
 * rather than two copies that could drift). Restricted to
 * `frontmatter.type === "paper"` so it can never match a same-named
 * author/concept/etc. page; ties (should never happen in practice) break on
 * the alphabetically smallest id, mirroring `loadBundle`'s wikilink
 * suffix-index tie-break.
 */
export function findPaperPage(bundle: Bundle, slug: string): WikiPage | null {
  const suffix = `/${slug}`
  const matches = [...bundle.pages.values()]
    .filter((p) => p.frontmatter.type === "paper" && (p.id === slug || p.id.endsWith(suffix)))
    .sort((a, b) => a.id.localeCompare(b.id))
  return matches[0] ?? null
}

/**
 * Pure state derivation from an already-resolved paper page (or null for
 * "no page yet"). `frontmatter.status` maps ingested->ingested,
 * saved/enriched->saved (carrying the real status through), and a missing
 * status field (pages written before the status field existed) defaults to
 * "saved" as the safe fallback — never "discovery" (the page IS there) and
 * never "ingested" (nothing confirms that).
 */
export function pageStateFromPage(page: WikiPage | null): PaperPageState {
  if (!page) return { state: "discovery" }

  const status = page.frontmatter.status
  if (status === "ingested") return { state: "ingested", status: "ingested" }
  if (status === "saved" || status === "enriched") return { state: "saved", status }
  return { state: "saved", status: "saved" }
}

/**
 * Pure resolver for `/paper/[key]`'s three progressive states: does a paper
 * page for this slug exist in the bundle yet (via the routing-tolerant
 * `findPaperPage`), and if so which save/ingest tier is it at?
 */
export function resolvePaperPageState(bundle: Bundle, slug: string): PaperPageState {
  return pageStateFromPage(findPaperPage(bundle, slug))
}

/**
 * True only when a paper page is INGESTED and its own frontmatter confirms
 * no full text was acquired (a genuinely paywalled/unavailable source) — C1
 * (whole-branch review). A saved-but-not-yet-ingested stub never sets
 * `full_text` at all (see `buildSaveStubChangeset`), so its absence must
 * never read as "known unavailable" and disable Read: only an ingested
 * page's `full_text` is authoritative, since ingest is the step that
 * actually tried to acquire it.
 */
export function isFullTextKnownUnavailable(page: WikiPage | null): boolean {
  return page?.frontmatter.status === "ingested" && page?.frontmatter.full_text === false
}
