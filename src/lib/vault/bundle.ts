import type { VaultStorage } from "./storage"
import type { WikiPage } from "./types"
import { parseDocument } from "./frontmatter"
import { extractWikilinks } from "./wikilinks"

export interface Bundle {
  pages: Map<string, WikiPage>
  links: Array<{ from: string; to: string }>
  errors: Array<{ path: string; message: string; kind: "parse" | "ambiguity" }>
}

export async function loadBundle(storage: VaultStorage): Promise<Bundle> {
  const pages = new Map<string, WikiPage>()
  const errors: Bundle["errors"] = []

  for (const path of await storage.list("wiki/")) {
    if (!path.endsWith(".md")) continue
    const raw = await storage.read(path)
    if (raw === null) continue
    try {
      const { frontmatter, body } = parseDocument(raw)
      const id = path.slice(0, -3)
      pages.set(id, { id, path, frontmatter, body })
    } catch (e) {
      errors.push({ path, message: (e as Error).message, kind: "parse" })
    }
  }

  const bundle: Bundle = { pages, links: [], errors }

  // Built once (not per-link) so resolving every wikilink in the vault is
  // O(pages + links) instead of O(pages x links x pages).
  const suffixIndex = buildSuffixIndex(pages)

  for (const page of pages.values()) {
    const reportedSlugs = new Set<string>()
    for (const slug of extractWikilinks(page.body)) {
      if (!slug.includes("/")) {
        const candidates = suffixIndex.get(slug)
        if (candidates && candidates.length > 1 && !reportedSlugs.has(slug)) {
          reportedSlugs.add(slug)
          errors.push({
            path: page.path,
            message: `ambiguous wikilink [[${slug}]]: ${candidates.join(", ")}`,
            kind: "ambiguity",
          })
        }
      }
      const target = resolveBySuffixIndex(pages, suffixIndex, slug)
      if (target && target.id !== page.id) bundle.links.push({ from: page.id, to: target.id })
    }
  }
  return bundle
}

// Maps a page id's final path segment (e.g. "x" for "wiki/concepts/x") to
// the sorted list of page ids sharing that segment. Sorting up front makes
// plain-slug resolution's tie-break (see resolveBySuffixIndex) a simple
// "take the first element".
function buildSuffixIndex(pages: Map<string, WikiPage>): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const id of pages.keys()) {
    const segment = id.split("/").pop()!
    const bucket = index.get(segment)
    if (bucket) bucket.push(id)
    else index.set(segment, [id])
  }
  for (const bucket of index.values()) bucket.sort()
  return index
}

function resolveBySuffixIndex(
  pages: Map<string, WikiPage>,
  suffixIndex: Map<string, string[]>,
  slug: string,
): WikiPage | null {
  if (slug.includes("/")) {
    // Path-qualified slug (e.g. "concepts/x"): match against the id suffix
    // rather than only the final segment, so same-named pages in different
    // directories (wiki/concepts/x vs wiki/methods/x) can be disambiguated
    // by a linking author writing [[concepts/x]] / [[methods/x]].
    const suffix = "/" + slug
    const fullId = "wiki/" + slug
    const matches = [...pages.keys()].filter((id) => id === fullId || id.endsWith(suffix)).sort()
    return matches.length > 0 ? (pages.get(matches[0]) ?? null) : null
  }

  const candidates = suffixIndex.get(slug)
  if (!candidates || candidates.length === 0) return null
  // Ambiguity rule: when multiple pages share a final id segment, the
  // deterministic winner is the alphabetically smallest id (candidates are
  // pre-sorted by buildSuffixIndex). loadBundle separately records this
  // collision into bundle.errors so it can be surfaced by lint; resolveLink
  // itself just applies the tie-break for any caller.
  return pages.get(candidates[0]) ?? null
}

export function resolveLink(bundle: Bundle, slug: string): WikiPage | null {
  return resolveBySuffixIndex(bundle.pages, buildSuffixIndex(bundle.pages), slug)
}

export function backlinks(bundle: Bundle, id: string): string[] {
  return bundle.links.filter((l) => l.to === id).map((l) => l.from).sort()
}
