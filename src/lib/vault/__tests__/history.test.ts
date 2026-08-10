import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { applyChangeset, revertPersistedChangeset } from "../changesets"
import { getChangesetPreview, listChangesetHistory } from "../history"

describe("listChangesetHistory", () => {
  it("returns an applied changeset as a content-free file-operation preview", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write("wiki/concepts/existing.md", "old")
    await applyChangeset(storage, {
      id: "cs-history-1",
      skill: "project-update",
      model: "none",
      timestamp: "2026-08-10T10:00:00.000Z",
      changes: [
        { path: "wiki/concepts/existing.md", before: "old", after: "new" },
        { path: "wiki/notes/created.md", before: null, after: "created" },
      ],
    })

    await expect(listChangesetHistory(storage)).resolves.toEqual([
      {
        changesetId: "cs-history-1",
        timestamp: "2026-08-10T10:00:00.000Z",
        skill: "project-update",
        model: "none",
        status: "applied",
        files: [
          { path: "wiki/concepts/existing.md", operation: "update" },
          { path: "wiki/notes/created.md", operation: "create" },
        ],
        divergedPaths: [],
      },
    ])
  })

  it("derives reverted and diverged states, sorts newest first, and skips corrupt records", async () => {
    const storage = new MemoryVaultStorage()

    await storage.write("wiki/projects/old.md", "old")
    await applyChangeset(storage, {
      id: "cs-reverted",
      skill: "project-delete",
      model: "none",
      timestamp: "2026-08-10T09:00:00.000Z",
      changes: [{ path: "wiki/projects/old.md", before: "old", after: null }],
    })
    await revertPersistedChangeset(storage, "cs-reverted")

    await applyChangeset(storage, {
      id: "cs-diverged",
      skill: "project-update",
      model: "none",
      timestamp: "2026-08-10T11:00:00.000Z",
      changes: [{ path: "wiki/projects/current.md", before: null, after: "created" }],
    })
    await storage.write("wiki/projects/current.md", "independent edit")
    await storage.write(".scispark/changesets/corrupt.json", "{not json")
    await storage.write(".scispark/changesets/../invalid.json", "{}")

    const result = await listChangesetHistory(storage)

    expect(result).toHaveLength(2)
    expect(result.map((record) => record.changesetId)).toEqual([
      "cs-diverged",
      "cs-reverted",
    ])
    expect(result[0]).toMatchObject({
      status: "diverged",
      divergedPaths: ["wiki/projects/current.md"],
      files: [{ path: "wiki/projects/current.md", operation: "create" }],
    })
    expect(result[1]).toMatchObject({
      status: "reverted",
      divergedPaths: [],
      files: [{ path: "wiki/projects/old.md", operation: "delete" }],
    })
  })

  it("loads a validated before/after preview without exposing a forged private record", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write("wiki/concepts/existing.md", "before")
    await applyChangeset(storage, {
      id: "cs-preview",
      skill: "wiki-update",
      model: "none",
      timestamp: "2026-08-10T12:00:00.000Z",
      changes: [{ path: "wiki/concepts/existing.md", before: "before", after: "after" }],
    })

    await expect(getChangesetPreview(storage, "cs-preview")).resolves.toMatchObject({
      changesetId: "cs-preview",
      status: "applied",
      changes: [{ path: "wiki/concepts/existing.md", before: "before", after: "after" }],
    })

    await storage.write(
      ".scispark/changesets/forged-preview.json",
      JSON.stringify({
        id: "forged-preview",
        skill: "forged",
        model: "none",
        timestamp: "2026-08-10T12:00:00.000Z",
        changes: [
          { path: ".scispark/settings.json", before: "old secret", after: "new secret" },
        ],
      }),
    )
    await expect(getChangesetPreview(storage, "forged-preview")).rejects.toThrow(/not found|corrupt/i)
  })
})
