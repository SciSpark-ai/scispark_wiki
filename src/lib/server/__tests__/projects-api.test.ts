import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as projectsRoute from "@/app/api/projects/route"
import * as projectRoute from "@/app/api/projects/[id]/route"
import * as membersRoute from "@/app/api/projects/[id]/members/route"
import * as notesRoute from "@/app/api/projects/[id]/notes/route"
import * as noteRoute from "@/app/api/projects/[id]/notes/[noteId]/route"
import { serializeDocument } from "../../vault/frontmatter"
import { revisionOf } from "../../projects/repository"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"

describe("Projects API", () => {
  let storage: MemoryVaultStorage

  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })

  afterEach(() => setServerVaultForTests(null))

  it("creates and lists real projects with strict request validation", async () => {
    const invalid = await projectsRoute.POST(
      new Request("http://x/api/projects", {
        method: "POST",
        body: JSON.stringify({
          title: "Strict project",
          description: "",
          instructions: "",
          overview: "",
          injected: true,
        }),
      }),
    )
    expect(invalid.status).toBe(400)

    const created = await projectsRoute.POST(
      new Request("http://x/api/projects", {
        method: "POST",
        body: JSON.stringify({
          title: "Strict project",
          description: "Real vault data",
          instructions: "Stay grounded",
          overview: "Project overview",
        }),
      }),
    )
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    expect(createdBody).toMatchObject({
      result: { id: "strict-project", title: "Strict project" },
      changesetId: expect.stringMatching(/^cs-/),
      warnings: [],
    })

    const listed = await projectsRoute.GET()
    expect(listed.status).toBe(200)
    expect((await listed.json()).projects).toEqual([
      expect.objectContaining({ id: "strict-project", title: "Strict project" }),
    ])

    const detail = await projectRoute.GET(
      new Request("http://x/api/projects/strict-project"),
      { params: Promise.resolve({ id: "strict-project" }) },
    )
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({ id: "strict-project", overview: "Project overview\n" })
  })

  it("updates with revision conflicts and uses an explicit delete preview token", async () => {
    const created = await projectsRoute.POST(
      new Request("http://x/api/projects", {
        method: "POST",
        body: JSON.stringify({
          title: "Revision project",
          description: "",
          instructions: "",
          overview: "",
        }),
      }),
    )
    const original = (await created.json()).result

    const updated = await projectRoute.PATCH(
      new Request("http://x/api/projects/revision-project", {
        method: "PATCH",
        body: JSON.stringify({
          revision: original.revision,
          title: "Renamed",
          description: "New description",
          instructions: "New instructions",
          overview: "New overview",
        }),
      }),
      { params: Promise.resolve({ id: "revision-project" }) },
    )
    expect(updated.status).toBe(200)
    expect((await updated.json()).result).toMatchObject({
      id: "revision-project",
      title: "Renamed",
    })

    const stale = await projectRoute.PATCH(
      new Request("http://x/api/projects/revision-project", {
        method: "PATCH",
        body: JSON.stringify({
          revision: original.revision,
          title: "Stale",
          description: "",
          instructions: "",
          overview: "",
        }),
      }),
      { params: Promise.resolve({ id: "revision-project" }) },
    )
    expect(stale.status).toBe(409)

    const previewResponse = await projectRoute.DELETE(
      new Request("http://x/api/projects/revision-project?preview=true", { method: "DELETE" }),
      { params: Promise.resolve({ id: "revision-project" }) },
    )
    expect(previewResponse.status).toBe(200)
    const preview = (await previewResponse.json()).result
    expect(preview.files).toEqual([
      { path: "wiki/projects/revision-project.md", operation: "delete" },
    ])

    const deleted = await projectRoute.DELETE(
      new Request("http://x/api/projects/revision-project", {
        method: "DELETE",
        body: JSON.stringify({
          revision: preview.revision,
          previewRevision: preview.previewRevision,
        }),
      }),
      { params: Promise.resolve({ id: "revision-project" }) },
    )
    expect(deleted.status).toBe(200)
    expect((await deleted.json()).result.id).toBe("revision-project")
  })

  it("mutates membership and project notes through revision-checked APIs", async () => {
    const created = await projectsRoute.POST(
      new Request("http://x/api/projects", {
        method: "POST",
        body: JSON.stringify({
          title: "API project",
          description: "",
          instructions: "",
          overview: "",
        }),
      }),
    )
    expect(created.status).toBe(201)

    const paper = serializeDocument(
      {
        type: "paper",
        title: "API paper",
        created: "2026-08-11",
        updated: "2026-08-11",
        tags: [],
        related: [],
        sources: [],
        projects: [],
      },
      "Paper body",
    )
    await storage.write("wiki/papers/api-paper.md", paper)

    const added = await membersRoute.POST(
      new Request("http://x/api/projects/api-project/members", {
        method: "POST",
        body: JSON.stringify({
          pageId: "wiki/papers/api-paper",
          revision: await revisionOf(paper),
        }),
      }),
      { params: Promise.resolve({ id: "api-project" }) },
    )
    expect(added.status).toBe(200)
    const addedBody = await added.json()
    expect(addedBody.result.counts.papers).toBe(1)

    const noteCreated = await notesRoute.POST(
      new Request("http://x/api/projects/api-project/notes", {
        method: "POST",
        body: JSON.stringify({
          title: "API note",
          content: "Draft",
          sources: ["paper:wiki/papers/api-paper"],
        }),
      }),
      { params: Promise.resolve({ id: "api-project" }) },
    )
    expect(noteCreated.status).toBe(201)
    const note = (await noteCreated.json()).result

    const noteUpdated = await noteRoute.PATCH(
      new Request("http://x/api/projects/api-project/notes/api-note", {
        method: "PATCH",
        body: JSON.stringify({
          revision: note.revision,
          title: "API note",
          content: "Saved explicitly",
        }),
      }),
      { params: Promise.resolve({ id: "api-project", noteId: "api-note" }) },
    )
    expect(noteUpdated.status).toBe(200)
    const savedNote = (await noteUpdated.json()).result
    expect(savedNote.content).toBe("Saved explicitly\n")

    const listed = await notesRoute.GET(
      new Request("http://x/api/projects/api-project/notes"),
      { params: Promise.resolve({ id: "api-project" }) },
    )
    expect((await listed.json()).notes).toHaveLength(1)

    const invalidRemoval = await membersRoute.DELETE(
      new Request("http://x/api/projects/api-project/members", {
        method: "DELETE",
        body: JSON.stringify({
          pageId: "wiki/papers/api-paper",
        }),
      }),
      { params: Promise.resolve({ id: "api-project" }) },
    )
    expect(invalidRemoval.status).toBe(400)

    const removed = await membersRoute.DELETE(
      new Request("http://x/api/projects/api-project/members", {
        method: "DELETE",
        body: JSON.stringify({
          pageId: "wiki/papers/api-paper",
          revision: addedBody.result.members[0].revision,
        }),
      }),
      { params: Promise.resolve({ id: "api-project" }) },
    )
    expect(removed.status).toBe(200)
    expect((await removed.json()).result.counts.papers).toBe(0)

    const noteDeleted = await noteRoute.DELETE(
      new Request("http://x/api/projects/api-project/notes/api-note", {
        method: "DELETE",
        body: JSON.stringify({ revision: savedNote.revision }),
      }),
      { params: Promise.resolve({ id: "api-project", noteId: "api-note" }) },
    )
    expect(noteDeleted.status).toBe(200)
    expect((await noteDeleted.json()).result).toEqual({ id: "api-note" })
  })
})
