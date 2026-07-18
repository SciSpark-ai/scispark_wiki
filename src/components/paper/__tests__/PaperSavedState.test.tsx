// @vitest-environment jsdom
//
// Task 10 gate (see .superpowers/sdd/task-10-brief.md Step 2): given a
// `status: enriched` paper page carrying tldr/tags/related frontmatter,
// PaperMeta + RelatedInWiki together render the TL;DR, the tag chips, and
// links (via wikiHref) to the related pages, resolved to their real titles.
import { it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { loadBundle } from "@/lib/vault/bundle"
import { serializeDocument } from "@/lib/vault/frontmatter"
import { buildPaperPage } from "@/lib/wiki/authoring"
import type { PaperRecord } from "@/lib/papers/types"
import type { Frontmatter } from "@/lib/vault/types"
import { PaperMeta } from "../PaperMeta"
import { RelatedInWiki, resolveRelatedPages } from "../RelatedInWiki"

const NOW = "2026-07-17T00:00:00.000Z"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG for Auditory Attention Decoding",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

it("renders TL;DR, tag chips, and related-page links for a status:enriched paper page", async () => {
  const storage = new MemoryVaultStorage()

  const methodFrontmatter: Frontmatter = {
    type: "method",
    title: "Ear-EEG Recording",
    created: NOW,
    updated: NOW,
    tags: [],
    related: [],
    sources: [],
  }

  const draft = buildPaperPage(PAPER, { fullText: false, today: "2026-07-17", status: "enriched" })
  draft.frontmatter.tldr = "A wearable ear-EEG method for tracking auditory attention in real environments."
  draft.frontmatter.tags = ["ear-eeg", "auditory attention"]
  // Bare slug (I1, whole-branch review) — related[] stores the final path
  // segment, not a full "wiki/..." id; resolveRelatedPages resolves it via
  // resolveLink the same way the knowledge graph does.
  draft.frontmatter.related = ["ear-eeg-recording"]

  await storage.write("wiki/methods/ear-eeg-recording.md", serializeDocument(methodFrontmatter, "# Ear-EEG Recording\n"))
  await storage.write(draft.path, serializeDocument(draft.frontmatter, draft.body))

  const bundle = await loadBundle(storage)
  const pageId = draft.path.replace(/\.md$/, "")
  const page = bundle.pages.get(pageId)
  expect(page).toBeDefined()
  const fm = page!.frontmatter

  expect(fm.status).toBe("enriched")

  const tldr = typeof fm.tldr === "string" ? fm.tldr : undefined
  const relatedPages = resolveRelatedPages(bundle, fm.related)

  const html = renderToStaticMarkup(
    <>
      <PaperMeta tldr={tldr} tags={fm.tags} />
      <RelatedInWiki related={relatedPages} />
    </>,
  )

  // TL;DR
  expect(html).toContain("A wearable ear-EEG method for tracking auditory attention in real environments.")
  // Tag chips
  expect(html).toContain("ear-eeg")
  expect(html).toContain("auditory attention")
  // Related link: real title, not the raw id, via wikiHref's canonical route
  expect(html).toContain("Ear-EEG Recording")
  expect(html).toContain('href="/wiki/methods/ear-eeg-recording"')
  expect(html).not.toContain("wiki/methods/ear-eeg-recording<")
})
