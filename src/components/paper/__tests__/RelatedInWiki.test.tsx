// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { loadBundle } from "@/lib/vault/bundle"
import { serializeDocument } from "@/lib/vault/frontmatter"
import type { Frontmatter } from "@/lib/vault/types"
import { RelatedInWiki, resolveRelatedPages } from "../RelatedInWiki"

const NOW = "2026-07-17T00:00:00.000Z"

function pageFrontmatter(type: string, title: string): Frontmatter {
  return { type, title, created: NOW, updated: NOW, tags: [], related: [], sources: [] }
}

async function vaultWithPages(): Promise<MemoryVaultStorage> {
  const storage = new MemoryVaultStorage()
  await storage.write("wiki/methods/ear-eeg.md", serializeDocument(pageFrontmatter("method", "Ear-EEG"), "# Ear-EEG\n"))
  await storage.write(
    "wiki/concepts/auditory-attention.md",
    serializeDocument(pageFrontmatter("concept", "Auditory Attention"), "# Auditory Attention\n"),
  )
  return storage
}

// I1 (whole-branch review): related[] now stores BARE slugs (see
// buildEnrichMergeChangeset's bareSlug helper), matching the convention
// every other related[] writer in this app uses — resolveRelatedPages must
// resolve those the same way the wiki/graph does (resolveLink's suffix
// match), not via a direct full-id bundle.pages.get lookup.
describe("resolveRelatedPages (pure)", () => {
  it("resolves bare slugs to titles (and real full ids for href), preserving order", async () => {
    const bundle = await loadBundle(await vaultWithPages())
    const resolved = resolveRelatedPages(bundle, ["ear-eeg", "auditory-attention"])
    expect(resolved).toEqual([
      { id: "wiki/methods/ear-eeg", title: "Ear-EEG" },
      { id: "wiki/concepts/auditory-attention", title: "Auditory Attention" },
    ])
  })

  it("drops slugs that no longer resolve in the bundle, never surfacing the raw slug", async () => {
    const bundle = await loadBundle(await vaultWithPages())
    const resolved = resolveRelatedPages(bundle, ["ear-eeg", "deleted-page"])
    expect(resolved).toEqual([{ id: "wiki/methods/ear-eeg", title: "Ear-EEG" }])
  })

  it("resolves both stale full-id entries and new bare-slug entries", async () => {
    const bundle = await loadBundle(await vaultWithPages())
    // Mix of legacy full-id (stale from before the Enrich fix) and new bare-slug format
    const resolved = resolveRelatedPages(bundle, ["wiki/methods/ear-eeg", "auditory-attention"])
    expect(resolved).toEqual([
      { id: "wiki/methods/ear-eeg", title: "Ear-EEG" },
      { id: "wiki/concepts/auditory-attention", title: "Auditory Attention" },
    ])
  })

  it("returns [] for undefined/empty input", async () => {
    const bundle = await loadBundle(await vaultWithPages())
    expect(resolveRelatedPages(bundle, undefined)).toEqual([])
    expect(resolveRelatedPages(bundle, [])).toEqual([])
  })
})

describe("RelatedInWiki", () => {
  it("links to each related page's title (not raw id) via wikiHref", () => {
    const html = renderToStaticMarkup(
      <RelatedInWiki
        related={[
          { id: "wiki/methods/ear-eeg", title: "Ear-EEG" },
          { id: "wiki/concepts/auditory-attention", title: "Auditory Attention" },
        ]}
      />,
    )
    expect(html).toContain("Ear-EEG")
    expect(html).toContain("Auditory Attention")
    expect(html).toContain('href="/wiki/methods/ear-eeg"')
    expect(html).toContain('href="/wiki/concepts/auditory-attention"')
    expect(html).not.toContain("wiki/methods/ear-eeg<")
  })

  it("renders nothing when there are no related pages", () => {
    const html = renderToStaticMarkup(<RelatedInWiki related={[]} />)
    expect(html).toBe("")
  })
})
