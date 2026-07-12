import type { VaultStorage } from "./storage"
import type { WikiPage } from "./types"
import { parseDocument } from "./frontmatter"
import { extractWikilinks } from "./wikilinks"

export interface Bundle {
  pages: Map<string, WikiPage>
  links: Array<{ from: string; to: string }>
  errors: Array<{ path: string; message: string }>
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
      errors.push({ path, message: (e as Error).message })
    }
  }

  const bundle: Bundle = { pages, links: [], errors }
  for (const page of pages.values()) {
    for (const slug of extractWikilinks(page.body)) {
      const target = resolveLink(bundle, slug)
      if (target) bundle.links.push({ from: page.id, to: target.id })
    }
  }
  return bundle
}

export function resolveLink(bundle: Bundle, slug: string): WikiPage | null {
  for (const page of bundle.pages.values()) {
    if (page.id.split("/").pop() === slug) return page
  }
  return null
}

export function backlinks(bundle: Bundle, id: string): string[] {
  return bundle.links.filter((l) => l.to === id).map((l) => l.from).sort()
}
