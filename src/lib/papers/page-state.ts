import type { Bundle } from "../vault/bundle"
import type { PaperStatus } from "../wiki/authoring"

export interface PaperPageState {
  state: "discovery" | "saved" | "ingested"
  status?: PaperStatus
}

/**
 * Pure resolver for `/paper/[key]`'s three progressive states: does a paper
 * page for this slug exist in the bundle yet, and if so which save/ingest
 * tier is it at? Looks up `wiki/papers/<slug>` directly — the default paper
 * routing dir every paper-page write in this app uses (buildPaperPage /
 * buildSaveStubChangeset) — rather than consulting schema.md routing, since
 * this resolver is pure (bundle + slug only, no storage access).
 *
 * No page yet -> "discovery". `frontmatter.status` maps ingested->ingested,
 * saved/enriched->saved (carrying the real status through), and a missing
 * status field (pages written before the status field existed) defaults to
 * "saved" as the safe fallback — never "discovery" (the page IS there) and
 * never "ingested" (nothing confirms that).
 */
export function resolvePaperPageState(bundle: Bundle, slug: string): PaperPageState {
  const page = bundle.pages.get(`wiki/papers/${slug}`)
  if (!page) return { state: "discovery" }

  const status = page.frontmatter.status
  if (status === "ingested") return { state: "ingested", status: "ingested" }
  if (status === "saved" || status === "enriched") return { state: "saved", status }
  return { state: "saved", status: "saved" }
}
