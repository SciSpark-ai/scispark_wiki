import { describe, expect, it } from "vitest"
import type { VaultStorage } from "../storage"
import { MemoryVaultStorage } from "../memory-storage"
import { commitChangeset, undoChangeset } from "../mutations"
import type { Changeset } from "../types"

class ThrowDerivedStorage implements VaultStorage {
  private inner = new MemoryVaultStorage()

  read(path: string): Promise<string | null> {
    return this.inner.read(path)
  }

  async write(path: string, content: string): Promise<void> {
    if (path === "index.md" || path === "log.md") {
      throw new Error(`derived write failed: ${path}`)
    }
    await this.inner.write(path, content)
  }

  readBinary(path: string): Promise<Uint8Array | null> {
    return this.inner.readBinary(path)
  }

  writeBinary(path: string, data: Uint8Array): Promise<void> {
    return this.inner.writeBinary(path, data)
  }

  delete(path: string): Promise<void> {
    return this.inner.delete(path)
  }

  list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
}

function changeset(id: string): Changeset {
  return {
    id,
    skill: "project-create",
    model: "none",
    timestamp: "2026-08-10T12:00:00.000Z",
    changes: [{ path: "wiki/projects/test.md", before: null, after: "project" }],
  }
}

describe("vault mutation coordinator", () => {
  it("returns explicit warnings when derived refresh fails after a successful apply", async () => {
    const storage = new ThrowDerivedStorage()
    const result = await commitChangeset(storage, changeset("cs-warning"))

    expect(result).toEqual({
      changesetId: "cs-warning",
      warnings: [
        expect.objectContaining({ code: "index-refresh-failed" }),
        expect.objectContaining({ code: "log-append-failed" }),
      ],
    })
    expect(await storage.read("wiki/projects/test.md")).toBe("project")
    expect(await storage.read(".scispark/changesets/cs-warning.json")).not.toBeNull()
  })

  it("refreshes derived files after persisted-id undo", async () => {
    const storage = new MemoryVaultStorage()
    await commitChangeset(storage, changeset("cs-undo"))

    const result = await undoChangeset(storage, "cs-undo", {
      timestamp: "2026-08-10T13:00:00.000Z",
    })

    expect(result).toEqual({ changesetId: "cs-undo", warnings: [] })
    expect(await storage.read("wiki/projects/test.md")).toBeNull()
    expect(await storage.read("index.md")).not.toContain("test")
    expect(await storage.read("log.md")).toContain("undo | cs-undo")
  })
})
