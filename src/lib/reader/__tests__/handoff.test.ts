import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import type { PaperRecord } from "../../papers/types"
import { paperSlug } from "../../wiki/authoring"
import { writeReaderHandoff, readReaderHandoff, readReaderHandoffBySlug, readerHandoffPath } from "../handoff"

function paper(overrides: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...overrides }
}

describe("reader handoff", () => {
  it("round-trips a PaperRecord by paperKey", async () => {
    const storage = new MemoryVaultStorage()
    const p = paper({ title: "Attention Is All You Need", ids: { arxiv: "1706.03762" }, abstract: "The dominant..." })
    await writeReaderHandoff(storage, p)
    const got = await readReaderHandoff(storage, "arxiv:1706.03762")
    expect(got).toEqual(p)
  })

  it("returns null for a missing handoff", async () => {
    const storage = new MemoryVaultStorage()
    expect(await readReaderHandoff(storage, "arxiv:0000.00000")).toBeNull()
  })

  it("returns null for corrupt JSON", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(readerHandoffPath("arxiv:1706.03762"), "{not json")
    expect(await readReaderHandoff(storage, "arxiv:1706.03762")).toBeNull()
  })

  it("ignores a stale file whose own key no longer matches the requested key", async () => {
    const storage = new MemoryVaultStorage()
    // Write a record under one key's path but request a different key.
    const p = paper({ title: "Some Paper", ids: { arxiv: "1706.03762" } })
    await storage.write(readerHandoffPath("arxiv:9999.99999"), JSON.stringify(p))
    expect(await readReaderHandoff(storage, "arxiv:9999.99999")).toBeNull()
  })

  it("writes under .scispark/reader/", async () => {
    expect(readerHandoffPath("arxiv:1706.03762")).toMatch(/^\.scispark\/reader\/.+\.json$/)
  })

  // SP2 Task 13: a single write makes the record resolvable by EITHER
  // identifier, so a caller who only has a PaperRecord (e.g. a fresh
  // /papers search result) doesn't need to know in advance whether the
  // downstream page will resolve by paperKey or by paperSlug.
  it("also round-trips the same PaperRecord by paperSlug", async () => {
    const storage = new MemoryVaultStorage()
    const p = paper({ title: "Attention Is All You Need", ids: { arxiv: "1706.03762" }, abstract: "The dominant..." })
    await writeReaderHandoff(storage, p)
    const got = await readReaderHandoffBySlug(storage, paperSlug(p))
    expect(got).toEqual(p)
  })

  it("readReaderHandoffBySlug returns null for a missing handoff", async () => {
    const storage = new MemoryVaultStorage()
    expect(await readReaderHandoffBySlug(storage, "some-unknown-slug")).toBeNull()
  })

  it("readReaderHandoffBySlug ignores a stale file whose own slug no longer matches", async () => {
    const storage = new MemoryVaultStorage()
    const p = paper({ title: "Some Paper", ids: { arxiv: "1706.03762" } })
    await storage.write(readerHandoffPath("some-other-slug"), JSON.stringify(p))
    expect(await readReaderHandoffBySlug(storage, "some-other-slug")).toBeNull()
  })
})
