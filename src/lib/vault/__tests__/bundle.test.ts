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
