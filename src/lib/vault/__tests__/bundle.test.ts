import { describe, it, expect, beforeEach } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { serializeDocument } from "../frontmatter"
import { loadBundle, resolveLink, backlinks } from "../bundle"
import type { Frontmatter } from "../types"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type, title, created: "2026-07-11", updated: "2026-07-11",
  tags: [], related: [], sources: ["s.pdf"], ...extra,
})

let storage: MemoryVaultStorage
beforeEach(async () => {
  storage = new MemoryVaultStorage()
  await storage.write("wiki/concepts/saint-protocol.md",
    serializeDocument(fm("concept", "SAINT Protocol"), "Uses [[tms]]."))
  await storage.write("wiki/methods/tms.md",
    serializeDocument(fm("method", "TMS"), "A method."))
  await storage.write("index.md", "# Index (reserved, not a page)")
  await storage.write("wiki/broken.md", "no frontmatter here")
})

describe("loadBundle", () => {
  it("loads pages with path-as-id, skips reserved, collects errors", async () => {
    const b = await loadBundle(storage)
    expect([...b.pages.keys()].sort()).toEqual(["wiki/concepts/saint-protocol", "wiki/methods/tms"])
    expect(b.pages.get("wiki/concepts/saint-protocol")!.frontmatter.title).toBe("SAINT Protocol")
    expect(b.errors).toHaveLength(1)
    expect(b.errors[0].path).toBe("wiki/broken.md")
  })
  it("derives link edges from wikilinks", async () => {
    const b = await loadBundle(storage)
    expect(b.links).toEqual([{ from: "wiki/concepts/saint-protocol", to: "wiki/methods/tms" }])
  })
  it("resolveLink matches by final id segment; backlinks invert edges", async () => {
    const b = await loadBundle(storage)
    expect(resolveLink(b, "tms")!.id).toBe("wiki/methods/tms")
    expect(resolveLink(b, "nope")).toBeNull()
    expect(backlinks(b, "wiki/methods/tms")).toEqual(["wiki/concepts/saint-protocol"])
  })
})

describe("resolveLink with path-qualified and ambiguous slugs", () => {
  let dup: MemoryVaultStorage
  beforeEach(async () => {
    dup = new MemoryVaultStorage()
    await dup.write("wiki/concepts/x.md", serializeDocument(fm("concept", "X Concept"), "A concept page."))
    await dup.write("wiki/methods/x.md", serializeDocument(fm("method", "X Method"), "A method page."))
  })

  it("resolves path-qualified slugs by id-suffix, disambiguating same-named pages", async () => {
    const b = await loadBundle(dup)
    expect(resolveLink(b, "concepts/x")!.id).toBe("wiki/concepts/x")
    expect(resolveLink(b, "methods/x")!.id).toBe("wiki/methods/x")
  })

  it("resolves an ambiguous plain slug to the alphabetically smallest id and records the collision once", async () => {
    await dup.write("wiki/notes/linker.md", serializeDocument(fm("note", "Linker"), "See [[x]] for details."))
    const b = await loadBundle(dup)
    expect(resolveLink(b, "x")!.id).toBe("wiki/concepts/x")
    expect(b.errors.filter((e) => e.path === "wiki/notes/linker.md")).toEqual([
      { path: "wiki/notes/linker.md", message: "ambiguous wikilink [[x]]: wiki/concepts/x, wiki/methods/x" },
    ])
  })
})

describe("self-links", () => {
  it("produce no edge and no self-backlink", async () => {
    const selfStorage = new MemoryVaultStorage()
    await selfStorage.write(
      "wiki/concepts/self.md",
      serializeDocument(fm("concept", "Self"), "See [[self]] for more."),
    )
    const b = await loadBundle(selfStorage)
    expect(b.links).toEqual([])
    expect(backlinks(b, "wiki/concepts/self")).toEqual([])
  })
})
