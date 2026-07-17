import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { paperSlug, buildPaperPage } from "../../wiki/authoring"
import { applyChangeset } from "../../vault/changesets"
import { serializeDocument } from "../../vault/frontmatter"
import { resolvePaperBySlug } from "../resolve"
import type { PaperRecord } from "../types"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "A Study of Ear-EEG",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
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
})
