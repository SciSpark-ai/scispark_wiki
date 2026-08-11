import { describe, expect, it, vi } from "vitest"
import { ProjectApiError, listProjectsRemote, updateProjectRemote } from "../client"

describe("projects client", () => {
  it("returns typed list data and preserves conflict status for honest UI states", async () => {
    const project = {
      id: "p",
      title: "Project",
      description: "",
      instructions: "",
      revision: "a".repeat(64),
      createdAt: "2026-08-11",
      updatedAt: "2026-08-11",
      members: [],
      conversations: [],
      counts: { members: 0, papers: 0, notes: 0, conversations: 0 },
    }
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ projects: [project] }))
      .mockResolvedValueOnce(Response.json({ error: "stale edit" }, { status: 409 }))

    await expect(listProjectsRemote(fetchFn)).resolves.toEqual([project])
    await expect(
      updateProjectRemote(
        "p",
        {
          revision: "a".repeat(64),
          title: "Project",
          description: "",
          instructions: "",
          overview: "",
        },
        fetchFn,
      ),
    ).rejects.toMatchObject({ status: 409, message: "stale edit" } satisfies Partial<ProjectApiError>)
  })
})
