import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as historyRoute from "@/app/api/history/changes/route"
import * as previewRoute from "@/app/api/history/changes/[changesetId]/route"
import { setServerVaultForTests } from "../vault"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { commitChangeset } from "../../vault/mutations"

describe("changes History API", () => {
  let storage: MemoryVaultStorage

  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })

  afterEach(() => setServerVaultForTests(null))

  it("lists content-derived, content-free changeset summaries", async () => {
    await commitChangeset(storage, {
      id: "cs-history-api",
      skill: "project-create",
      model: "none",
      timestamp: "2026-08-10T12:00:00.000Z",
      changes: [{ path: "wiki/projects/api.md", before: null, after: "secret body" }],
    })

    const response = await historyRoute.GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.changes).toEqual([
      expect.objectContaining({
        changesetId: "cs-history-api",
        status: "applied",
        files: [{ path: "wiki/projects/api.md", operation: "create" }],
      }),
    ])
    expect(JSON.stringify(body)).not.toContain("secret body")
  })

  it("returns a validated before/after preview for one changeset", async () => {
    await commitChangeset(storage, {
      id: "cs-history-preview-api",
      skill: "project-update",
      model: "none",
      timestamp: "2026-08-10T12:00:00.000Z",
      changes: [{ path: "wiki/projects/api.md", before: null, after: "project body" }],
    })

    const response = await previewRoute.GET(
      new Request("http://x/api/history/changes/cs-history-preview-api"),
      { params: Promise.resolve({ changesetId: "cs-history-preview-api" }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      changesetId: "cs-history-preview-api",
      changes: [
        { path: "wiki/projects/api.md", before: null, after: "project body" },
      ],
    })
  })

  it("undoes by persisted id and rejects client-supplied change contents", async () => {
    await commitChangeset(storage, {
      id: "cs-history-undo",
      skill: "project-create",
      model: "none",
      timestamp: "2026-08-10T12:00:00.000Z",
      changes: [{ path: "wiki/projects/api.md", before: null, after: "project" }],
    })

    const forged = await historyRoute.POST(
      new Request("http://x/api/history/changes", {
        method: "POST",
        body: JSON.stringify({
          changesetId: "cs-history-undo",
          changes: [{ path: ".scispark/settings.json", before: "bad", after: "secret" }],
        }),
      }),
    )
    expect(forged.status).toBe(400)
    expect(await storage.read("wiki/projects/api.md")).toBe("project")

    const response = await historyRoute.POST(
      new Request("http://x/api/history/changes", {
        method: "POST",
        body: JSON.stringify({ changesetId: "cs-history-undo" }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      changesetId: "cs-history-undo",
      warnings: [],
    })
    expect(await storage.read("wiki/projects/api.md")).toBeNull()
  })

  it("returns blocking paths when independent edits make undo unsafe", async () => {
    await commitChangeset(storage, {
      id: "cs-history-diverged",
      skill: "project-create",
      model: "none",
      timestamp: "2026-08-10T12:00:00.000Z",
      changes: [{ path: "wiki/projects/api.md", before: null, after: "project" }],
    })
    await storage.write("wiki/projects/api.md", "independent edit")

    const response = await historyRoute.POST(
      new Request("http://x/api/history/changes", {
        method: "POST",
        body: JSON.stringify({ changesetId: "cs-history-diverged" }),
      }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "changeset is diverged, not applied",
      status: "diverged",
      divergedPaths: ["wiki/projects/api.md"],
    })
    expect(await storage.read("wiki/projects/api.md")).toBe("independent edit")
  })
})
