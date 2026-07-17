import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { buildPaperPage } from "../../wiki/authoring"
import { buildSaveStubChangeset } from "../save"
import { applyChangeset } from "../../vault/changesets"
import { loadBundle } from "../../vault/bundle"
import type { PaperRecord } from "../types"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" }, title: "Ear-EEG", authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.", fields: [], source: "arxiv",
}

describe("buildPaperPage status", () => {
  it("writes the status frontmatter field", () => {
    const draft = buildPaperPage(PAPER, { fullText: false, today: "2026-07-17", status: "saved" })
    expect(draft.frontmatter.status).toBe("saved")
  })
})

describe("buildSaveStubChangeset", () => {
  it("creates a saved paper page and is a no-op when it already exists", async () => {
    const s = new MemoryVaultStorage()
    const cs = await buildSaveStubChangeset(s, PAPER, "2026-07-17")
    expect(cs).not.toBeNull()
    await applyChangeset(s, cs!)
    const bundle = await loadBundle(s)
    const page = [...bundle.pages.values()].find((p) => p.frontmatter.type === "paper")
    expect(page?.frontmatter.status).toBe("saved")
    expect(page?.frontmatter.full_text).toBe(false)
    // second call: page exists → null
    expect(await buildSaveStubChangeset(s, PAPER, "2026-07-17")).toBeNull()
  })
})
