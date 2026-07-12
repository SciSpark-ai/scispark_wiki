import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { applyChangeset, revertChangeset, loadChangeset, ChangesetConflictError } from "../changesets"
import type { Changeset } from "../types"

const cs = (changes: Changeset["changes"]): Changeset => ({
  id: "cs-1-abcd", skill: "ingest", model: "test-model",
  timestamp: "2026-07-11T00:00:00Z", changes,
})

describe("applyChangeset", () => {
  it("applies create + modify atomically and persists the record", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", "old")
    await applyChangeset(s, cs([
      { path: "wiki/concepts/a.md", before: "old", after: "new" },
      { path: "wiki/methods/b.md", before: null, after: "created" },
    ]))
    expect(await s.read("wiki/concepts/a.md")).toBe("new")
    expect(await s.read("wiki/methods/b.md")).toBe("created")
    expect(await loadChangeset(s, "cs-1-abcd")).not.toBeNull()
  })

  it("rejects the WHOLE changeset on any before-mismatch, writing nothing", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", "actually-different")
    await expect(applyChangeset(s, cs([
      { path: "wiki/concepts/a.md", before: "old", after: "new" },
      { path: "wiki/methods/b.md", before: null, after: "created" },
    ]))).rejects.toThrow(ChangesetConflictError)
    expect(await s.read("wiki/concepts/a.md")).toBe("actually-different")
    expect(await s.read("wiki/methods/b.md")).toBeNull()
  })
})

describe("revertChangeset", () => {
  it("restores before-states, deleting created files", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", "old")
    const c = cs([
      { path: "wiki/concepts/a.md", before: "old", after: "new" },
      { path: "wiki/methods/b.md", before: null, after: "created" },
    ])
    await applyChangeset(s, c)
    await revertChangeset(s, c)
    expect(await s.read("wiki/concepts/a.md")).toBe("old")
    expect(await s.read("wiki/methods/b.md")).toBeNull()
  })
})
