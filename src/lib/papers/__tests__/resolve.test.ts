import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { paperSlug, buildPaperPage } from "../../wiki/authoring"
import { applyChangeset } from "../../vault/changesets"
import { serializeDocument } from "../../vault/frontmatter"
import { writeReaderHandoff } from "../../reader/handoff"
import { DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION } from "../../trending/cache"
import { resolvePaperByKey, resolvePaperBySlug, extractAbstractFromBody } from "../resolve"
import type { PaperRecord } from "../types"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "A Study of Ear-EEG",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

const BREAKOUT_PAPER: PaperRecord = {
  ...PAPER,
  ids: { doi: "10.22331/q-2026-08-13-2189" },
  title: "A Trending Breakout Paper",
  source: "openalex",
}

async function writeTrendingBoard(s: MemoryVaultStorage) {
  await s.write(
    DASHBOARD_CACHE_PATH,
    JSON.stringify({
      version: TRENDING_BOARD_VERSION,
      generatedAt: "2026-08-29T21:51:44.393Z",
      topics: [{ papers: [{ record: PAPER, wikiPageId: null }] }],
      breakouts: [{ record: BREAKOUT_PAPER, citationCount: 12, wikiPageId: null }],
    }),
  )
}

async function writePaperPage(s: MemoryVaultStorage, paper: PaperRecord) {
  const draft = buildPaperPage(paper, { fullText: true, today: "2026-07-17" })
  await applyChangeset(s, {
    id: "cs-test",
    skill: "test",
    model: "test",
    timestamp: "2026-07-17T00:00:00.000Z",
    changes: [{ path: draft.path, before: null, after: serializeDocument(draft.frontmatter, draft.body) }],
  })
}

describe("resolvePaperBySlug", () => {
  it("resolves a paper from its wiki page frontmatter", async () => {
    const s = new MemoryVaultStorage()
    await writePaperPage(s, PAPER)
    const resolved = await resolvePaperBySlug(s, paperSlug(PAPER))
    expect(resolved?.ids.arxiv).toBe("2409.08710")
    expect(resolved?.title).toBe("A Study of Ear-EEG")
  })
  it("returns null for an unknown slug", async () => {
    const s = new MemoryVaultStorage()
    expect(await resolvePaperBySlug(s, "arxiv-9999-99999")).toBeNull()
  })

  // CRUX gap (SP2 Task 13): a paper reached straight from a /papers search
  // result is in neither the feed cache nor the wiki yet — the search page
  // stashes a reader handoff before navigating to /paper/<slug>, and
  // resolvePaperBySlug must be able to read it back by slug, with no feed
  // cache and no wiki page in play at all.
  it("resolves a freshly-searched paper via its reader handoff, with no feed cache and no wiki page", async () => {
    const s = new MemoryVaultStorage()
    await writeReaderHandoff(s, PAPER)
    const resolved = await resolvePaperBySlug(s, paperSlug(PAPER))
    expect(resolved?.ids.arxiv).toBe("2409.08710")
    expect(resolved?.title).toBe("A Study of Ear-EEG")
  })

  it("resolves topic and breakout papers straight from the trending cache", async () => {
    const s = new MemoryVaultStorage()
    await writeTrendingBoard(s)

    expect((await resolvePaperBySlug(s, paperSlug(PAPER)))?.title).toBe("A Study of Ear-EEG")
    expect((await resolvePaperBySlug(s, paperSlug(BREAKOUT_PAPER)))?.title).toBe("A Trending Breakout Paper")
    expect((await resolvePaperByKey(s, "doi:10.22331/q-2026-08-13-2189"))?.title).toBe(
      "A Trending Breakout Paper",
    )
  })

  it("ignores malformed trending records instead of crashing paper resolution", async () => {
    const s = new MemoryVaultStorage()
    await s.write(
      DASHBOARD_CACHE_PATH,
      JSON.stringify({
        version: TRENDING_BOARD_VERSION,
        generatedAt: "2026-08-29T21:51:44.393Z",
        topics: [{ papers: [{ record: { title: "missing required fields" } }] }],
        breakouts: [{ record: null }],
      }),
    )

    await expect(resolvePaperBySlug(s, "missing-required-fields")).resolves.toBeNull()
  })
})

describe("extractAbstractFromBody", () => {
  it("pulls the text under a ## Abstract heading", () => {
    const body = "# Title\n\n## Abstract\n\nWe study ear-EEG.\n"
    expect(extractAbstractFromBody(body)).toBe("We study ear-EEG.")
  })

  it("stops at the next ## heading and does not swallow later sections", () => {
    const body =
      "# Title\n\n## Abstract\n\nLine one.\nLine two.\n\n## Links\n\n- DOI: something\n"
    expect(extractAbstractFromBody(body)).toBe("Line one.\nLine two.")
  })

  it("returns undefined when there is no Abstract section", () => {
    const body = "# Title\n\n## Digest\n\nSome digest.\n"
    expect(extractAbstractFromBody(body)).toBeUndefined()
  })

  it("returns undefined for an empty Abstract section", () => {
    const body = "# Title\n\n## Abstract\n\n## Links\n\n- x\n"
    expect(extractAbstractFromBody(body)).toBeUndefined()
  })

  it("round-trips a real buildPaperPage body", () => {
    const draft = buildPaperPage(PAPER, { fullText: true, today: "2026-07-17" })
    expect(extractAbstractFromBody(draft.body)).toBe("We study ear-EEG.")
  })
})
