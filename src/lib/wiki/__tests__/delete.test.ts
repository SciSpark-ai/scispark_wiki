import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"
import { loadChangeset } from "../../vault/changesets"
import { listIngests } from "../review-queue"
import { isDeletablePage, backlinkCount, deletePage, PROTECTED_PAGE_IDS } from "../delete"
// Test-only: undoIngest lives in the skills layer (which pulls in LLM/orchestrator
// deps), but it's pure over VaultStorage and is exactly the existing revert path this
// task's undo-for-free claim depends on — importing it here (not from delete.ts itself)
// keeps src/lib/wiki/delete.ts free of that dependency while still exercising the real
// undo surface. Safe: browser-purity only scans src/app, src/components, and a fixed
// CLIENT_LIB_FILES allowlist — this test file is none of those.
import { undoIngest } from "../../skills/ingest"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type, title, created: "2026-07-11", updated: "2026-07-11",
  tags: [], related: [], sources: ["s.pdf"], ...extra,
})

function page(id: string, path: string, frontmatter: Frontmatter, body = ""): WikiPage {
  return { id, path, frontmatter, body }
}

describe("isDeletablePage", () => {
  it("is false for reserved root files by id", () => {
    expect(isDeletablePage(page("index", "index.md", fm("note", "Index")))).toBe(false)
    expect(isDeletablePage(page("schema", "schema.md", fm("note", "Schema")))).toBe(false)
    expect(isDeletablePage(page("log", "log.md", fm("note", "Log")))).toBe(false)
    expect(isDeletablePage(page("purpose", "purpose.md", fm("note", "Purpose")))).toBe(false)
  })

  it("is false for the user-model pages, bare or wiki/-prefixed id", () => {
    for (const id of PROTECTED_PAGE_IDS) {
      expect(isDeletablePage(page(id, `${id}.md`, fm("note", id)))).toBe(false)
      expect(isDeletablePage(page(`wiki/${id}`, `wiki/${id}.md`, fm("note", id)))).toBe(false)
    }
  })

  it("is true for an ordinary wiki page", () => {
    expect(
      isDeletablePage(page("wiki/concepts/tms", "wiki/concepts/tms.md", fm("concept", "TMS"))),
    ).toBe(true)
  })
})

describe("backlinkCount", () => {
  it("dedupes multiple wikilinks from the same source page into one backlink", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      "wiki/concepts/a.md",
      serializeDocument(fm("concept", "A"), "See [[tms]] and again [[tms]]."),
    )
    await storage.write(
      "wiki/concepts/b.md",
      serializeDocument(fm("concept", "B"), "Also see [[tms]]."),
    )
    await storage.write("wiki/methods/tms.md", serializeDocument(fm("method", "TMS"), "A method."))

    const bundle = await loadBundle(storage)
    expect(backlinkCount(bundle, "wiki/methods/tms")).toBe(2)
    expect(backlinkCount(bundle, "wiki/concepts/a")).toBe(0)
  })
})

describe("deletePage", () => {
  async function seedVault() {
    const storage = new MemoryVaultStorage()
    await storage.write("wiki/concepts/tms.md", serializeDocument(fm("concept", "TMS"), "A concept."))
    await storage.write(
      "wiki/methods/saint.md",
      serializeDocument(fm("method", "SAINT"), "Uses [[tms]]."),
    )
    await storage.write("index.md", "# Index\n")
    await storage.write("log.md", "# Log\n")
    return storage
  }

  it("removes the file, writes the changeset record, rebuilds index.md, and appends the log line", async () => {
    const storage = await seedVault()
    const before = await storage.read("wiki/concepts/tms.md")

    const bundle = await loadBundle(storage)
    const target = bundle.pages.get("wiki/concepts/tms") as WikiPage
    const changesetId = await deletePage(storage, target)

    expect(await storage.read("wiki/concepts/tms.md")).toBeNull()

    const cs = await loadChangeset(storage, changesetId)
    expect(cs).not.toBeNull()
    expect(cs!.skill).toBe("delete")
    expect(cs!.model).toBe("none")
    expect(cs!.changes).toEqual([{ path: "wiki/concepts/tms.md", before, after: null }])

    const index = await storage.read("index.md")
    expect(index).not.toContain("[[tms]]")
    expect(index).not.toContain("TMS")

    const log = await storage.read("log.md")
    expect(log).toMatch(/delete \| wiki\/concepts\/tms/)

    const ingests = await listIngests(storage)
    const record = ingests.find((r) => r.changesetId === changesetId)
    expect(record).toBeDefined()
    expect(record!.skill).toBe("delete")
    expect(record!.reverted).toBeUndefined()
  })

  it("undoIngest after deletePage restores the file byte-identical and re-lists it in index.md", async () => {
    const storage = await seedVault()
    const before = await storage.read("wiki/concepts/tms.md")

    const bundle = await loadBundle(storage)
    const target = bundle.pages.get("wiki/concepts/tms") as WikiPage
    const changesetId = await deletePage(storage, target)

    expect(await storage.read("wiki/concepts/tms.md")).toBeNull()

    await undoIngest(storage, changesetId)

    expect(await storage.read("wiki/concepts/tms.md")).toBe(before)

    const index = await storage.read("index.md")
    expect(index).toContain("[[tms]]")

    const ingests = await listIngests(storage)
    const record = ingests.find((r) => r.changesetId === changesetId)
    expect(record!.reverted).toBe(true)
  })
})
