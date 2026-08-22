import type {
  ProjectDeletePreview,
  ProjectDetail,
  ProjectMutation,
  ProjectNote,
  ProjectSummary,
} from "./types"

export class ProjectApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fetchFn: typeof fetch,
): Promise<T> {
  const response = await fetchFn(url, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : response.statusText || `request failed with status ${response.status}`
    throw new ProjectApiError(response.status, message)
  }
  return body as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

export async function listProjectsRemote(fetchFn: typeof fetch = fetch): Promise<ProjectSummary[]> {
  const body = await requestJson<{ projects: ProjectSummary[] }>("/api/projects", undefined, fetchFn)
  return body.projects
}

export function getProjectRemote(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectDetail> {
  return requestJson(`/api/projects/${encodeURIComponent(id)}`, undefined, fetchFn)
}

export function createProjectRemote(
  input: { title: string; description: string; instructions: string; overview: string },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<ProjectDetail>> {
  return requestJson("/api/projects", jsonInit("POST", input), fetchFn)
}

export function updateProjectRemote(
  id: string,
  input: {
    revision: string
    title: string
    description: string
    instructions: string
    overview: string
  },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<ProjectDetail>> {
  return requestJson(`/api/projects/${encodeURIComponent(id)}`, jsonInit("PATCH", input), fetchFn)
}

export async function previewDeleteProjectRemote(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectDeletePreview> {
  const body = await requestJson<{ result: ProjectDeletePreview }>(
    `/api/projects/${encodeURIComponent(id)}?preview=true`,
    { method: "DELETE" },
    fetchFn,
  )
  return body.result
}

export function deleteProjectRemote(
  id: string,
  input: { revision: string; previewRevision: string },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<{ id: string; affectedPaths: string[] }>> {
  return requestJson(`/api/projects/${encodeURIComponent(id)}`, jsonInit("DELETE", input), fetchFn)
}

export function addProjectMemberRemote(
  projectId: string,
  input: { pageId: string; revision: string },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<ProjectDetail>> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/members`,
    jsonInit("POST", input),
    fetchFn,
  )
}

export function removeProjectMemberRemote(
  projectId: string,
  input: { pageId: string; revision: string },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<ProjectDetail>> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/members`,
    jsonInit("DELETE", input),
    fetchFn,
  )
}

export async function listProjectNotesRemote(
  projectId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectNote[]> {
  const body = await requestJson<{ notes: ProjectNote[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/notes`,
    undefined,
    fetchFn,
  )
  return body.notes
}

export function createProjectNoteRemote(
  projectId: string,
  input: { title: string; content: string; sources: string[] },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<ProjectNote>> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/notes`,
    jsonInit("POST", input),
    fetchFn,
  )
}

export function updateProjectNoteRemote(
  projectId: string,
  noteId: string,
  input: { revision: string; title: string; content: string },
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<ProjectNote>> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(noteId)}`,
    jsonInit("PATCH", input),
    fetchFn,
  )
}

export function deleteProjectNoteRemote(
  projectId: string,
  noteId: string,
  revision: string,
  fetchFn: typeof fetch = fetch,
): Promise<ProjectMutation<{ id: string }>> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(noteId)}`,
    jsonInit("DELETE", { revision }),
    fetchFn,
  )
}
