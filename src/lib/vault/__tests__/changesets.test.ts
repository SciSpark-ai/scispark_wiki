import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import type { VaultStorage } from "../storage"
import {
  applyChangeset,
  revertChangeset,
  loadChangeset,
  makeChangesetId,
  ChangesetConflictError,
  ChangesetInvalidError,
  ChangesetApplyError,
} from "../changesets"
import type { Changeset } from "../types"

const cs = (changes: Changeset["changes"], id = "cs-1-abcd"): Changeset => ({
  id, skill: "ingest", model: "test-model",
  timestamp: "2026-07-11T00:00:00Z", changes,
})

/** Wraps MemoryVaultStorage and throws on the Nth call to write(), to simulate
 * a mid-apply failure (e.g. OPFS quota exceeded). */
class ThrowingWriteStorage implements VaultStorage {
  private inner = new MemoryVaultStorage()
  private writeCount = 0
  constructor(private throwOnCall: number) {}
  async read(path: string): Promise<string | null> {
    return this.inner.read(path)
  }
  async write(path: string, content: string): Promise<void> {
    this.writeCount++
    if (this.writeCount === this.throwOnCall) {
      throw new Error("simulated write failure")
    }
    return this.inner.write(path, content)
  }
  async delete(path: string): Promise<void> {
    return this.inner.delete(path)
  }
  async list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
  snapshot(): Map<string, string> {
    return this.inner.snapshot()
  }
  /** Seeds initial content directly, bypassing the write() call counter. */
  async seed(path: string, content: string): Promise<void> {
    return this.inner.write(path, content)
  }
}

/** Wraps MemoryVaultStorage and throws only when writing to `.scispark/changesets/` paths,
 * to simulate an audit-record write failure (e.g. quota exhausted on the final write). */
class ThrowOnChangesetPathStorage implements VaultStorage {
  private inner = new MemoryVaultStorage()
  async read(path: string): Promise<string | null> {
    return this.inner.read(path)
  }
  async write(path: string, content: string): Promise<void> {
    if (path.startsWith(".scispark/changesets/")) {
      throw new Error("simulated changeset record write failure")
    }
    return this.inner.write(path, content)
  }
  async delete(path: string): Promise<void> {
    return this.inner.delete(path)
  }
  async list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
  snapshot(): Map<string, string> {
    return this.inner.snapshot()
  }
  async seed(path: string, content: string): Promise<void> {
    return this.inner.write(path, content)
  }
}

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

  it("rejects a changeset with duplicate paths before any write or conflict check", async () => {
    const s = new MemoryVaultStorage()
    // Note: a.md does not exist in storage, so both `before` values are also
    // wrong — if the conflict check ran first this would throw
    // ChangesetConflictError instead. Duplicate-path detection must win.
    await expect(applyChangeset(s, cs([
      { path: "wiki/concepts/a.md", before: "old", after: "new" },
      { path: "wiki/concepts/a.md", before: "different-old", after: "other-new" },
    ]))).rejects.toThrow(ChangesetInvalidError)
    expect(await s.read("wiki/concepts/a.md")).toBeNull()
  })

  it("rejects applying a changeset whose id already has a persisted record, before applying any changes", async () => {
    const s = new MemoryVaultStorage()
    const c = cs([{ path: "wiki/concepts/new.md", before: null, after: "content" }])
    const recordPath = `.scispark/changesets/${c.id}.json`
    await s.write(recordPath, JSON.stringify({ fake: "existing-record" }))

    await expect(applyChangeset(s, c)).rejects.toThrow(ChangesetInvalidError)

    expect(await s.read("wiki/concepts/new.md")).toBeNull()
    expect(await s.read(recordPath)).toBe(JSON.stringify({ fake: "existing-record" }))
  })

  it("rolls back already-applied changes and does not persist the record when a write fails mid-apply", async () => {
    const s = new ThrowingWriteStorage(2) // 2nd write() call throws
    await s.seed("wiki/concepts/a.md", "a-old")
    await s.seed("wiki/concepts/b.md", "b-old")

    const c = cs([
      { path: "wiki/concepts/a.md", before: "a-old", after: "a-new" },   // write #1: succeeds
      { path: "wiki/concepts/b.md", before: "b-old", after: "b-new" },   // write #2: throws
      { path: "wiki/concepts/c.md", before: null, after: "c-new" },      // never reached
    ])

    let caught: unknown
    try {
      await applyChangeset(s, c)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ChangesetApplyError)
    const applyErr = caught as ChangesetApplyError
    expect(applyErr.appliedCount).toBe(1)
    expect(applyErr.rolledBack).toBe(true)
    expect(applyErr.originalError).toBeInstanceOf(Error)

    // Fully restored: a.md rolled back to its pre-apply state.
    expect(await s.read("wiki/concepts/a.md")).toBe("a-old")
    // b.md was never actually written (the write threw), so it's untouched.
    expect(await s.read("wiki/concepts/b.md")).toBe("b-old")
    // c.md was never reached.
    expect(await s.read("wiki/concepts/c.md")).toBeNull()

    // The changeset JSON record must NOT be persisted for a failed apply.
    expect(await loadChangeset(s, c.id)).toBeNull()
  })

  it("rolls back all changes when the audit-record write fails", async () => {
    const s = new ThrowOnChangesetPathStorage()
    await s.seed("wiki/concepts/a.md", "a-old")
    await s.seed("wiki/concepts/b.md", "b-old")

    const c = cs([
      { path: "wiki/concepts/a.md", before: "a-old", after: "a-new" },
      { path: "wiki/concepts/b.md", before: "b-old", after: "b-new" },
    ])

    let caught: unknown
    try {
      await applyChangeset(s, c)
    } catch (err) {
      caught = err
    }

    // Should throw ChangesetApplyError (not raw Error)
    expect(caught).toBeInstanceOf(ChangesetApplyError)
    const applyErr = caught as ChangesetApplyError
    expect(applyErr.appliedCount).toBe(2)
    expect(applyErr.rolledBack).toBe(true)

    // All page changes must be rolled back to their pre-apply states
    expect(await s.read("wiki/concepts/a.md")).toBe("a-old")
    expect(await s.read("wiki/concepts/b.md")).toBe("b-old")

    // No audit record should exist
    expect(await loadChangeset(s, c.id)).toBeNull()
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

  it("throws ChangesetConflictError and reverts nothing when current content doesn't match `after` (never applied)", async () => {
    const s = new MemoryVaultStorage()
    const c = cs([{ path: "wiki/concepts/a.md", before: "original", after: "would-be-new" }])
    // The changeset was never applied; something else wrote unrelated content.
    await s.write("wiki/concepts/a.md", "someone-elses-work")

    await expect(revertChangeset(s, c)).rejects.toThrow(ChangesetConflictError)
    expect(await s.read("wiki/concepts/a.md")).toBe("someone-elses-work")
  })

  it("force:true skips the guard and reverts anyway", async () => {
    const s = new MemoryVaultStorage()
    const c = cs([{ path: "wiki/concepts/a.md", before: "original", after: "would-be-new" }])
    await s.write("wiki/concepts/a.md", "someone-elses-work")

    await revertChangeset(s, c, { force: true })
    expect(await s.read("wiki/concepts/a.md")).toBe("original")
  })
})

describe("makeChangesetId", () => {
  it("generates an id with an 8 hex char suffix", () => {
    const id = makeChangesetId()
    expect(id).toMatch(/^cs-\d+-[0-9a-f]{8}$/)
  })
})
