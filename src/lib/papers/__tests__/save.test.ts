import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { buildPaperPage, paperSlug } from "../../wiki/authoring"
import { buildSaveStubChangeset } from "../save"
import { applyChangeset } from "../../vault/changesets"
import { loadBundle } from "../../vault/bundle"
import { loadRouting } from "../../wiki/schema-routing"
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

  it("respects a custom schema.md routing for the paper type (no duplicate vs ingest paths)", async () => {
    const s = new MemoryVaultStorage()
    await s.write(
      "schema.md",
      "## Page Types\n\n| paper | wiki/library |\n",
    )
    // Sanity: confirm the routing actually parses to the custom dir before
    // trusting the save-path assertion below.
    expect((await loadRouting(s))["paper"]).toBe("wiki/library")

    const slug = paperSlug(PAPER)
    const cs = await buildSaveStubChangeset(s, PAPER, "2026-07-17")
    expect(cs).not.toBeNull()
    expect(cs!.changes[0].path).toBe(`wiki/library/${slug}.md`)
    await applyChangeset(s, cs!)

    const bundle = await loadBundle(s)
    expect(bundle.pages.has(`wiki/library/${slug}`)).toBe(true)
    expect(bundle.pages.has(`wiki/papers/${slug}`)).toBe(false)

    // Re-save is a no-op at the routed dir, not a duplicate.
    expect(await buildSaveStubChangeset(s, PAPER, "2026-07-17")).toBeNull()
  })
})
