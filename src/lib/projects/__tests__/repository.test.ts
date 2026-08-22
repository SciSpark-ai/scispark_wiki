import { describe, expect, it } from "vitest"
import { parseDocument, serializeDocument } from "../../vault/frontmatter"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { undoChangeset } from "../../vault/mutations"
import {
  addProjectMember,
  createProjectNote,
  createProject,
  deleteProject,
  deleteProjectNote,
  listProjectNotes,
  listProjects,
  previewDeleteProject,
  ProjectConflictError,
  ProjectValidationError,
  revisionOf,
  updateProjectNote,
  updateProject,
} from "../repository"

describe("project repository", () => {
  it("creates a schema-routed project with a stable collision-safe slug", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      "schema.md",
      "## Page Types\n\n| project | wiki/research-projects |\n| note | wiki/research-notes |\n",
    )

    const first = await createProject(storage, {
      title: "Reliable ABR Biomarkers",
      description: "Repeatable auditory biomarkers.",
      instructions: "Prefer validated findings.",
      overview: "# Reliable ABR Biomarkers\n\nWorking scope.",
      now: new Date("2026-08-11T10:00:00.000Z"),
    })
    const second = await createProject(storage, {
      title: "Reliable ABR Biomarkers",
      description: "A second project.",
      instructions: "",
      overview: "",
      now: new Date("2026-08-11T10:01:00.000Z"),
    })

    expect(first.result.id).toBe("reliable-abr-biomarkers")
    expect(second.result.id).toBe("reliable-abr-biomarkers-2")
    expect(first.changesetId).toMatch(/^cs-/)
    expect(first.warnings).toEqual([])

    const raw = await storage.read("wiki/research-projects/reliable-abr-biomarkers.md")
    expect(raw).not.toBeNull()
    const parsed = parseDocument(raw as string)
    expect(parsed.frontmatter).toMatchObject({
      type: "project",
      title: "Reliable ABR Biomarkers",
      description: "Repeatable auditory biomarkers.",
      instructions: "Prefer validated findings.",
    })

    const projects = await listProjects(storage)
    expect(projects.map((project) => project.id)).toEqual([
      "reliable-abr-biomarkers-2",
      "reliable-abr-biomarkers",
    ])
    expect(projects[0]).toMatchObject({
      members: [],
      conversations: [],
      counts: { members: 0, papers: 0, notes: 0, conversations: 0 },
    })
    expect(projects[0].revision).toMatch(/^[a-f0-9]{64}$/)
  })

  it("renames metadata without changing the stable slug and rejects a stale revision", async () => {
    const storage = new MemoryVaultStorage()
    const created = await createProject(storage, {
      title: "Original title",
      description: "Original description",
      instructions: "Original instructions",
      overview: "Original overview",
      now: new Date("2026-08-11T10:00:00.000Z"),
    })

    const updated = await updateProject(storage, "original-title", {
      revision: created.result.revision,
      title: "Renamed project",
      description: "Updated description",
      instructions: "Updated instructions",
      overview: "Updated overview",
      now: new Date("2026-08-12T10:00:00.000Z"),
    })

    expect(updated.result).toMatchObject({
      id: "original-title",
      title: "Renamed project",
      description: "Updated description",
      instructions: "Updated instructions",
      overview: "Updated overview\n",
      updatedAt: "2026-08-12",
    })
    expect(await storage.read("wiki/projects/renamed-project.md")).toBeNull()

    await expect(
      updateProject(storage, "original-title", {
        revision: created.result.revision,
        title: "Stale overwrite",
        description: "",
        instructions: "",
        overview: "",
        now: new Date("2026-08-13T10:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProjectConflictError)
    expect((await listProjects(storage))[0].title).toBe("Renamed project")
  })

  it("adds membership on the member page while preserving unrelated frontmatter and body", async () => {
    const storage = new MemoryVaultStorage()
    const created = await createProject(storage, {
      title: "Auditory biomarkers",
      description: "",
      instructions: "",
      overview: "",
      now: new Date("2026-08-11T10:00:00.000Z"),
    })
    const paper = serializeDocument(
      {
        type: "paper",
        title: "ABR reliability",
        created: "2026-08-01",
        updated: "2026-08-01",
        tags: ["abr"],
        related: ["auditory-system"],
        sources: ["doi:10.1/example"],
        projects: ["existing-project"],
        custom: { keep: true },
      },
      "# ABR reliability\n\nKeep this body byte-for-byte in meaning.",
    )
    await storage.write("wiki/papers/abr-reliability.md", paper)

    const added = await addProjectMember(storage, created.result.id, {
      pageId: "wiki/papers/abr-reliability",
      revision: await revisionOf(paper),
      now: new Date("2026-08-12T10:00:00.000Z"),
    })

    const updatedRaw = await storage.read("wiki/papers/abr-reliability.md")
    const updatedPage = parseDocument(updatedRaw as string)
    expect(updatedPage.frontmatter).toMatchObject({
      tags: ["abr"],
      related: ["auditory-system"],
      sources: ["doi:10.1/example"],
      projects: ["existing-project", "auditory-biomarkers"],
      custom: { keep: true },
      updated: "2026-08-12",
    })
    expect(updatedPage.body).toBe("# ABR reliability\n\nKeep this body byte-for-byte in meaning.\n")
    expect(added.result.counts).toMatchObject({ members: 1, papers: 1 })
    expect(added.result.members[0]).toMatchObject({
      id: "wiki/papers/abr-reliability",
      type: "paper",
    })

    await expect(
      addProjectMember(storage, created.result.id, {
        pageId: "wiki/papers/abr-reliability",
        revision: await revisionOf(paper),
        now: new Date("2026-08-13T10:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProjectConflictError)
  })

  it("creates, explicitly saves, and deletes routed project notes with provenance", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      "schema.md",
      "## Page Types\n\n| project | wiki/projects |\n| note | wiki/research-notes |\n",
    )
    const project = await createProject(storage, {
      title: "Auditory biomarkers",
      description: "",
      instructions: "",
      overview: "",
      now: new Date("2026-08-11T10:00:00.000Z"),
    })

    const created = await createProjectNote(storage, project.result.id, {
      title: "Key takeaway",
      content: "Wave V latency is the leading candidate.",
      sources: ["paper:wiki/papers/abr-reliability"],
      now: new Date("2026-08-11T11:00:00.000Z"),
    })
    expect(created.result).toMatchObject({
      id: "key-takeaway",
      projectId: "auditory-biomarkers",
      title: "Key takeaway",
      content: "Wave V latency is the leading candidate.\n",
      sources: ["paper:wiki/papers/abr-reliability"],
    })
    expect(await storage.read("wiki/research-notes/key-takeaway.md")).not.toBeNull()

    const saved = await updateProjectNote(storage, project.result.id, created.result.id, {
      revision: created.result.revision,
      title: "Key takeaway",
      content: "Revised after review.",
      now: new Date("2026-08-12T11:00:00.000Z"),
    })
    expect(saved.result.content).toBe("Revised after review.\n")
    expect(saved.result.sources).toEqual(["paper:wiki/papers/abr-reliability"])
    expect((await listProjectNotes(storage, project.result.id))).toHaveLength(1)

    const deleted = await deleteProjectNote(storage, project.result.id, created.result.id, {
      revision: saved.result.revision,
      now: new Date("2026-08-13T11:00:00.000Z"),
    })
    expect(deleted.result).toEqual({ id: "key-takeaway" })
    expect(await storage.read("wiki/research-notes/key-takeaway.md")).toBeNull()
  })

  it("previews and atomically deletes/unlinks a project, then restores it through History undo", async () => {
    const storage = new MemoryVaultStorage()
    const project = await createProject(storage, {
      title: "Auditory biomarkers",
      description: "",
      instructions: "",
      overview: "",
      now: new Date("2026-08-11T10:00:00.000Z"),
    })
    const memberPath = "wiki/papers/member.md"
    const memberBefore = serializeDocument(
      {
        type: "paper",
        title: "Member",
        created: "2026-08-01",
        updated: "2026-08-01",
        tags: [],
        related: [],
        sources: [],
        projects: ["auditory-biomarkers", "keep-me"],
      },
      "Member body",
    )
    await storage.write(memberPath, memberBefore)

    const preview = await previewDeleteProject(storage, project.result.id)
    expect(preview.files).toEqual([
      { path: "wiki/projects/auditory-biomarkers.md", operation: "delete" },
      { path: memberPath, operation: "update" },
    ])

    const deleted = await deleteProject(storage, project.result.id, {
      revision: project.result.revision,
      previewRevision: preview.previewRevision,
      now: new Date("2026-08-12T10:00:00.000Z"),
    })
    expect(await storage.read("wiki/projects/auditory-biomarkers.md")).toBeNull()
    expect(parseDocument((await storage.read(memberPath)) as string).frontmatter.projects).toEqual([
      "keep-me",
    ])

    await undoChangeset(storage, deleted.changesetId)
    expect(await storage.read(memberPath)).toBe(memberBefore)
    expect((await listProjects(storage)).map((item) => item.id)).toEqual([
      "auditory-biomarkers",
    ])
  })

  it("isolates corrupt records and rejects traversal or malformed members before mutation", async () => {
    const storage = new MemoryVaultStorage()
    const project = await createProject(storage, {
      title: "Healthy project",
      description: "",
      instructions: "",
      overview: "",
      now: new Date("2026-08-11T10:00:00.000Z"),
    })
    await storage.write("wiki/projects/corrupt.md", "---\ntitle: broken\n---\n")
    const malformedMember = [
      "---",
      "type: paper",
      "title: Malformed member",
      "created: 2026-08-11",
      "updated: 2026-08-11",
      "tags: []",
      "related: []",
      "projects: [healthy-project]",
      "---",
      "",
      "Missing required sources.",
      "",
    ].join("\n")
    await storage.write("wiki/papers/malformed.md", malformedMember)

    expect((await listProjects(storage)).map((item) => item.id)).toEqual(["healthy-project"])
    await expect(
      addProjectMember(storage, project.result.id, {
        pageId: "wiki/../.scispark/settings",
        revision: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ProjectValidationError)
    await expect(previewDeleteProject(storage, project.result.id)).rejects.toBeInstanceOf(
      ProjectValidationError,
    )
    expect(await storage.read("wiki/projects/healthy-project.md")).not.toBeNull()
    expect(await storage.read("wiki/papers/malformed.md")).toBe(malformedMember)
  })
})
