// @vitest-environment jsdom
//
// Task 11 gate (see .superpowers/sdd/task-11-brief.md Step 2): given a
// `status: ingested` paper page — the wiki page an ingest run wrote, body
// carrying the LLM-authored synthesis — PaperSynthesis renders that body
// (reusing markdown-preview's renderMarkdown/preprocessWikilinks, so
// wikilinks resolve to real titles), a backlinks region listing pages that
// reference it, and a quiet "Edit in wiki →" link via wikiHref.
import { it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { loadBundle } from "@/lib/vault/bundle"
import { serializeDocument } from "@/lib/vault/frontmatter"
import { buildPaperPage } from "@/lib/wiki/authoring"
import type { PaperRecord } from "@/lib/papers/types"
import type { Frontmatter } from "@/lib/vault/types"
import { PaperSynthesis } from "../PaperSynthesis"

const NOW = "2026-07-17T00:00:00.000Z"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG for Auditory Attention Decoding",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

it("renders the ingested synthesis body, backlinks, and an Edit in wiki link", async () => {
  const storage = new MemoryVaultStorage()

  // The method page the synthesis wikilinks to, and — separately — the page
  // that links BACK to the paper (so Backlinks has something real to show).
  const methodFrontmatter: Frontmatter = {
    type: "method",
    title: "Ear-EEG Recording",
    created: NOW,
    updated: NOW,
    tags: [],
    related: [],
    sources: [],
  }
  await storage.write(
    "wiki/methods/ear-eeg-recording.md",
    serializeDocument(methodFrontmatter, "# Ear-EEG Recording\n\nUsed by [[2409-08710]].\n"),
  )

  const draft = buildPaperPage(PAPER, { fullText: true, today: "2026-07-17", status: "ingested" })
  const synthesisBody = [
    `# ${PAPER.title}`,
    "",
    "## Summary",
    "",
    "This paper introduces a wearable ear-EEG method (see [[ear-eeg-recording]]) for tracking auditory attention.",
  ].join("\n")
  await storage.write(draft.path, serializeDocument(draft.frontmatter, synthesisBody))

  const bundle = await loadBundle(storage)
  const pageId = draft.path.replace(/\.md$/, "")
  const page = bundle.pages.get(pageId)
  expect(page).toBeDefined()
  expect(page!.frontmatter.status).toBe("ingested")

  const html = renderToStaticMarkup(<PaperSynthesis bundle={bundle} page={page!} />)

  // Synthesis body rendered (heading + prose), wikilink resolved to the
  // method page's real title via a real /wiki href, not left as raw [[..]].
  expect(html).toContain("Summary")
  expect(html).toContain("This paper introduces a wearable ear-EEG method")
  expect(html).toContain("Ear-EEG Recording")
  expect(html).toContain('href="/wiki/methods/ear-eeg-recording"')
  expect(html).not.toContain("[[ear-eeg-recording]]")

  // Backlinks region: the method page links back to this paper page.
  expect(html).toContain("Backlinks")
  expect(html).toContain('href="/wiki/methods/ear-eeg-recording"')

  // Edit in wiki -> link, via wikiHref to the paper's own canonical route.
  expect(html).toContain("Edit in wiki")
  expect(html).toContain('href="/wiki/papers/2409-08710"')
})
