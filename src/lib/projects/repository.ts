import { listSessions } from "../chat/session"
import { makeChangesetId } from "../vault/changesets"
import { parseDocument, serializeDocument } from "../vault/frontmatter"
import { commitChangeset } from "../vault/mutations"
import type { VaultStorage } from "../vault/storage"
import type { Frontmatter, WikiPage } from "../vault/types"
import { slugifyTitle } from "../wiki/authoring"
import { loadRouting } from "../wiki/schema-routing"
import { revisionOf } from "./revision"
import type {
  CreateProjectInput,
  CreateProjectNoteInput,
  DeleteProjectInput,
  DeleteProjectNoteInput,
  ProjectConversation,
  ProjectDetail,
  ProjectDeletePreview,
  ProjectMember,
  ProjectMutation,
  ProjectMembershipInput,
  ProjectNote,
  ProjectSummary,
  UpdateProjectInput,
  UpdateProjectNoteInput,
} from "./types"

export class ProjectValidationError extends Error {}
export class ProjectNotFoundError extends Error {}
export class ProjectConflictError extends Error {}

const PROJECT_ID_RE = /^[a-z0-9\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af][a-z0-9\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af-]{0,127}$/

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ProjectValidationError(`${field} must be a string`)
  const normalized = value.trim()
  if (field === "title" && normalized.length === 0) {
    throw new ProjectValidationError("title must not be empty")
  }
  if (normalized.length > maxLength) {
    throw new ProjectValidationError(`${field} must be at most ${maxLength} characters`)
  }
  return normalized
}

export function assertProjectId(id: string): void {
  if (!PROJECT_ID_RE.test(id) || id.includes("..")) {
    throw new ProjectValidationError(`invalid project id: ${id}`)
  }
}

export { revisionOf } from "./revision"

function stringField(frontmatter: Frontmatter, field: string): string | null {
  const value = frontmatter[field]
  return typeof value === "string" ? value : null
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : null
}

async function readWikiPages(storage: VaultStorage): Promise<Array<{ page: WikiPage; raw: string }>> {
  const pages: Array<{ page: WikiPage; raw: string }> = []
  for (const path of await storage.list("wiki/")) {
    if (!path.endsWith(".md")) continue
    const raw = await storage.read(path)
    if (raw === null) continue
    try {
      const { frontmatter, body } = parseDocument(raw)
      pages.push({
        raw,
        page: { id: path.slice(0, -3), path, frontmatter, body },
      })
    } catch {
      // One corrupt page must not prevent healthy projects from rendering.
    }
  }
  return pages
}

function projectIdFromPath(path: string, projectDir: string): string | null {
  const prefix = `${projectDir}/`
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return null
  const id = path.slice(prefix.length, -3)
  if (id.includes("/")) return null
  try {
    assertProjectId(id)
    return id
  } catch {
    return null
  }
}

async function conversationsByProject(storage: VaultStorage): Promise<Map<string, ProjectConversation[]>> {
  const byProject = new Map<string, ProjectConversation[]>()
  for (const session of await listSessions(storage)) {
    const projectId = (session as { projectId?: unknown }).projectId
    if (typeof projectId !== "string") continue
    const conversations = byProject.get(projectId) ?? []
    conversations.push({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
    })
    byProject.set(projectId, conversations)
  }
  return byProject
}

async function projectFromPage(
  projectId: string,
  project: { page: WikiPage; raw: string },
  pages: Array<{ page: WikiPage; raw: string }>,
  conversations: ProjectConversation[],
): Promise<ProjectDetail | null> {
  const { frontmatter, body } = project.page
  if (frontmatter.type !== "project") return null
  const description = stringField(frontmatter, "description")
  const instructions = stringField(frontmatter, "instructions")
  if (description === null || instructions === null) return null

  const members: ProjectMember[] = []
  for (const candidate of pages) {
    if (candidate.page.path === project.page.path) continue
    const projectIds = stringArray(candidate.page.frontmatter.projects)
    if (projectIds?.includes(projectId)) {
      members.push({
        id: candidate.page.id,
        path: candidate.page.path,
        title: candidate.page.frontmatter.title,
        type: candidate.page.frontmatter.type,
        revision: await revisionOf(candidate.raw),
      })
    }
  }
  members.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))

  return {
    id: projectId,
    title: frontmatter.title,
    description,
    instructions,
    revision: await revisionOf(project.raw),
    createdAt: frontmatter.created,
    updatedAt: frontmatter.updated,
    overview: body,
    members,
    conversations,
    counts: {
      members: members.length,
      papers: members.filter((member) => member.type === "paper").length,
      notes: members.filter((member) => member.type === "note").length,
      conversations: conversations.length,
    },
  }
}

function projectSummary(detail: ProjectDetail): ProjectSummary {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    instructions: detail.instructions,
    revision: detail.revision,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    members: detail.members,
    conversations: detail.conversations,
    counts: detail.counts,
  }
}

export async function listProjects(storage: VaultStorage): Promise<ProjectSummary[]> {
  const routing = await loadRouting(storage)
  const projectDir = routing.project ?? "wiki/projects"
  const [pages, conversationMap] = await Promise.all([
    readWikiPages(storage),
    conversationsByProject(storage),
  ])
  const projects: ProjectSummary[] = []

  for (const candidate of pages) {
    const id = projectIdFromPath(candidate.page.path, projectDir)
    if (id === null) continue
    const detail = await projectFromPage(id, candidate, pages, conversationMap.get(id) ?? [])
    if (detail !== null) projects.push(projectSummary(detail))
  }

  return projects.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
  )
}

export async function createProject(
  storage: VaultStorage,
  input: CreateProjectInput,
): Promise<ProjectMutation<ProjectDetail>> {
  const title = requireText(input.title, "title", 200)
  const description = requireText(input.description, "description", 2_000)
  const instructions = requireText(input.instructions, "instructions", 10_000)
  const overview = requireText(input.overview, "overview", 100_000)
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new ProjectValidationError("now must be a valid date")

  const routing = await loadRouting(storage)
  const projectDir = routing.project ?? "wiki/projects"
  const existing = new Set(
    (await storage.list(`${projectDir}/`))
      .map((path) => projectIdFromPath(path, projectDir))
      .filter((id): id is string => id !== null),
  )
  const base = slugifyTitle(title)
  let id = base
  let suffix = 2
  while (existing.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  assertProjectId(id)

  const date = now.toISOString().slice(0, 10)
  const path = `${projectDir}/${id}.md`
  const content = serializeDocument(
    {
      type: "project",
      title,
      created: date,
      updated: date,
      tags: [],
      related: [],
      sources: [],
      description,
      instructions,
    },
    overview,
  )
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "project-create",
      model: "none",
      timestamp: now.toISOString(),
      changes: [{ path, before: null, after: content }],
    },
    { op: "project-create", summary: id },
  )
  const result = await getProject(storage, id)
  return { result, changesetId: mutation.changesetId, warnings: mutation.warnings }
}

export async function getProject(storage: VaultStorage, id: string): Promise<ProjectDetail> {
  assertProjectId(id)
  const routing = await loadRouting(storage)
  const projectDir = routing.project ?? "wiki/projects"
  const path = `${projectDir}/${id}.md`
  const raw = await storage.read(path)
  if (raw === null) throw new ProjectNotFoundError(`project not found: ${id}`)

  let frontmatter: Frontmatter
  let body: string
  try {
    ;({ frontmatter, body } = parseDocument(raw))
  } catch {
    throw new ProjectNotFoundError(`project not found or corrupt: ${id}`)
  }
  const pages = await readWikiPages(storage)
  const detail = await projectFromPage(
    id,
    { raw, page: { id: path.slice(0, -3), path, frontmatter, body } },
    pages,
    (await conversationsByProject(storage)).get(id) ?? [],
  )
  if (detail === null) throw new ProjectNotFoundError(`project not found or corrupt: ${id}`)
  return detail
}

export async function updateProject(
  storage: VaultStorage,
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectMutation<ProjectDetail>> {
  assertProjectId(id)
  if (!/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new ProjectValidationError("revision must be a SHA-256 hash")
  }
  const title = requireText(input.title, "title", 200)
  const description = requireText(input.description, "description", 2_000)
  const instructions = requireText(input.instructions, "instructions", 10_000)
  const overview = requireText(input.overview, "overview", 100_000)
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new ProjectValidationError("now must be a valid date")

  const routing = await loadRouting(storage)
  const projectDir = routing.project ?? "wiki/projects"
  const path = `${projectDir}/${id}.md`
  const before = await storage.read(path)
  if (before === null) throw new ProjectNotFoundError(`project not found: ${id}`)
  if ((await revisionOf(before)) !== input.revision) {
    throw new ProjectConflictError(`project changed since it was loaded: ${id}`)
  }

  let frontmatter: Frontmatter
  try {
    frontmatter = parseDocument(before).frontmatter
  } catch {
    throw new ProjectNotFoundError(`project not found or corrupt: ${id}`)
  }
  if (frontmatter.type !== "project") throw new ProjectNotFoundError(`project not found: ${id}`)
  const date = now.toISOString().slice(0, 10)
  const after = serializeDocument(
    {
      ...frontmatter,
      title,
      description,
      instructions,
      updated: date,
    },
    overview,
  )
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "project-update",
      model: "none",
      timestamp: now.toISOString(),
      changes: [{ path, before, after }],
    },
    { op: "project-update", summary: id },
  )
  const result = await getProject(storage, id)
  return { result, changesetId: mutation.changesetId, warnings: mutation.warnings }
}

function memberPath(pageId: string): string {
  if (
    pageId.length > 1_020 ||
    !pageId.startsWith("wiki/") ||
    pageId.endsWith(".md") ||
    pageId.includes("\\") ||
    pageId.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new ProjectValidationError(`invalid member page id: ${pageId}`)
  }
  return `${pageId}.md`
}

async function changeProjectMembership(
  storage: VaultStorage,
  projectId: string,
  input: ProjectMembershipInput,
  action: "add" | "remove",
): Promise<ProjectMutation<ProjectDetail>> {
  assertProjectId(projectId)
  if (!/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new ProjectValidationError("revision must be a SHA-256 hash")
  }
  await getProject(storage, projectId)
  const path = memberPath(input.pageId)
  const before = await storage.read(path)
  if (before === null) throw new ProjectNotFoundError(`member page not found: ${input.pageId}`)
  if ((await revisionOf(before)) !== input.revision) {
    throw new ProjectConflictError(`member page changed since it was loaded: ${input.pageId}`)
  }

  let frontmatter: Frontmatter
  let body: string
  try {
    ;({ frontmatter, body } = parseDocument(before))
  } catch {
    throw new ProjectValidationError(`member page is malformed: ${input.pageId}`)
  }
  const existing = frontmatter.projects === undefined ? [] : stringArray(frontmatter.projects)
  if (existing === null) {
    throw new ProjectValidationError(`member page projects must be an array: ${input.pageId}`)
  }
  const isMember = existing.includes(projectId)
  if ((action === "add" && isMember) || (action === "remove" && !isMember)) {
    throw new ProjectConflictError(
      action === "add"
        ? `page is already a member of project: ${input.pageId}`
        : `page is not a member of project: ${input.pageId}`,
    )
  }

  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new ProjectValidationError("now must be a valid date")
  const projects = action === "add"
    ? [...existing, projectId]
    : existing.filter((id) => id !== projectId)
  const after = serializeDocument(
    { ...frontmatter, projects, updated: now.toISOString().slice(0, 10) },
    body,
  )
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: `project-member-${action}`,
      model: "none",
      timestamp: now.toISOString(),
      changes: [{ path, before, after }],
    },
    { op: `project-member-${action}`, summary: `${projectId}: ${input.pageId}` },
  )
  return {
    result: await getProject(storage, projectId),
    changesetId: mutation.changesetId,
    warnings: mutation.warnings,
  }
}

export function addProjectMember(
  storage: VaultStorage,
  projectId: string,
  input: ProjectMembershipInput,
): Promise<ProjectMutation<ProjectDetail>> {
  return changeProjectMembership(storage, projectId, input, "add")
}

export function removeProjectMember(
  storage: VaultStorage,
  projectId: string,
  input: ProjectMembershipInput,
): Promise<ProjectMutation<ProjectDetail>> {
  return changeProjectMembership(storage, projectId, input, "remove")
}

function requireSources(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new ProjectValidationError("sources must be an array of strings")
  }
  const sources = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
  if (sources.length > 100 || sources.some((source) => source.length > 1_000)) {
    throw new ProjectValidationError("sources contains too many or overly long values")
  }
  return sources
}

async function noteFromRaw(
  id: string,
  projectId: string,
  raw: string,
): Promise<ProjectNote | null> {
  try {
    const { frontmatter, body } = parseDocument(raw)
    const projects = stringArray(frontmatter.projects)
    const sources = stringArray(frontmatter.sources)
    if (
      frontmatter.type !== "note" ||
      projects === null ||
      !projects.includes(projectId) ||
      sources === null
    ) {
      return null
    }
    return {
      id,
      projectId,
      title: frontmatter.title,
      content: body,
      sources,
      revision: await revisionOf(raw),
      createdAt: frontmatter.created,
      updatedAt: frontmatter.updated,
    }
  } catch {
    return null
  }
}

export async function listProjectNotes(
  storage: VaultStorage,
  projectId: string,
): Promise<ProjectNote[]> {
  assertProjectId(projectId)
  await getProject(storage, projectId)
  const routing = await loadRouting(storage)
  const noteDir = routing.note ?? "wiki/notes"
  const notes: ProjectNote[] = []
  for (const path of await storage.list(`${noteDir}/`)) {
    const id = projectIdFromPath(path, noteDir)
    if (id === null) continue
    const raw = await storage.read(path)
    if (raw === null) continue
    const note = await noteFromRaw(id, projectId, raw)
    if (note !== null) notes.push(note)
  }
  return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
}

export async function createProjectNote(
  storage: VaultStorage,
  projectId: string,
  input: CreateProjectNoteInput,
): Promise<ProjectMutation<ProjectNote>> {
  assertProjectId(projectId)
  await getProject(storage, projectId)
  const title = requireText(input.title, "title", 200)
  const content = requireText(input.content, "content", 100_000)
  const sources = requireSources(input.sources)
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new ProjectValidationError("now must be a valid date")
  const routing = await loadRouting(storage)
  const noteDir = routing.note ?? "wiki/notes"
  const existing = new Set(
    (await storage.list(`${noteDir}/`))
      .map((path) => projectIdFromPath(path, noteDir))
      .filter((id): id is string => id !== null),
  )
  const base = slugifyTitle(title)
  let id = base
  let suffix = 2
  while (existing.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  assertProjectId(id)
  const date = now.toISOString().slice(0, 10)
  const path = `${noteDir}/${id}.md`
  const after = serializeDocument(
    {
      type: "note",
      title,
      created: date,
      updated: date,
      tags: [],
      related: [],
      sources,
      projects: [projectId],
    },
    content,
  )
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "project-note-create",
      model: "none",
      timestamp: now.toISOString(),
      changes: [{ path, before: null, after }],
    },
    { op: "project-note-create", summary: `${projectId}: ${id}` },
  )
  const result = await noteFromRaw(id, projectId, after)
  if (result === null) throw new Error("created project note could not be parsed")
  return { result, changesetId: mutation.changesetId, warnings: mutation.warnings }
}

async function loadProjectNote(
  storage: VaultStorage,
  projectId: string,
  noteId: string,
): Promise<{ path: string; raw: string; note: ProjectNote; frontmatter: Frontmatter }> {
  assertProjectId(projectId)
  assertProjectId(noteId)
  await getProject(storage, projectId)
  const routing = await loadRouting(storage)
  const path = `${routing.note ?? "wiki/notes"}/${noteId}.md`
  const raw = await storage.read(path)
  if (raw === null) throw new ProjectNotFoundError(`project note not found: ${noteId}`)
  const note = await noteFromRaw(noteId, projectId, raw)
  if (note === null) throw new ProjectNotFoundError(`project note not found or corrupt: ${noteId}`)
  return { path, raw, note, frontmatter: parseDocument(raw).frontmatter }
}

export async function updateProjectNote(
  storage: VaultStorage,
  projectId: string,
  noteId: string,
  input: UpdateProjectNoteInput,
): Promise<ProjectMutation<ProjectNote>> {
  if (!/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new ProjectValidationError("revision must be a SHA-256 hash")
  }
  const loaded = await loadProjectNote(storage, projectId, noteId)
  if (loaded.note.revision !== input.revision) {
    throw new ProjectConflictError(`project note changed since it was loaded: ${noteId}`)
  }
  const title = requireText(input.title, "title", 200)
  const content = requireText(input.content, "content", 100_000)
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new ProjectValidationError("now must be a valid date")
  const after = serializeDocument(
    {
      ...loaded.frontmatter,
      title,
      updated: now.toISOString().slice(0, 10),
    },
    content,
  )
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "project-note-update",
      model: "none",
      timestamp: now.toISOString(),
      changes: [{ path: loaded.path, before: loaded.raw, after }],
    },
    { op: "project-note-update", summary: `${projectId}: ${noteId}` },
  )
  const result = await noteFromRaw(noteId, projectId, after)
  if (result === null) throw new Error("updated project note could not be parsed")
  return { result, changesetId: mutation.changesetId, warnings: mutation.warnings }
}

export async function deleteProjectNote(
  storage: VaultStorage,
  projectId: string,
  noteId: string,
  input: DeleteProjectNoteInput,
): Promise<ProjectMutation<{ id: string }>> {
  if (!/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new ProjectValidationError("revision must be a SHA-256 hash")
  }
  const loaded = await loadProjectNote(storage, projectId, noteId)
  if (loaded.note.revision !== input.revision) {
    throw new ProjectConflictError(`project note changed since it was loaded: ${noteId}`)
  }
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new ProjectValidationError("now must be a valid date")
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "project-note-delete",
      model: "none",
      timestamp: now.toISOString(),
      changes: [{ path: loaded.path, before: loaded.raw, after: null }],
    },
    { op: "project-note-delete", summary: `${projectId}: ${noteId}` },
  )
  return {
    result: { id: noteId },
    changesetId: mutation.changesetId,
    warnings: mutation.warnings,
  }
}

interface DeleteMemberState {
  path: string
  raw: string
  frontmatter: Frontmatter
  body: string
}

interface DeleteProjectState {
  path: string
  raw: string
  revision: string
  previewRevision: string
  members: DeleteMemberState[]
}

function malformedPageMentionsProject(raw: string, projectId: string): boolean {
  const frontmatterEnd = raw.indexOf("\n---", 4)
  if (!raw.startsWith("---\n") || frontmatterEnd === -1) return false
  const frontmatterText = raw.slice(4, frontmatterEnd)
  const escaped = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|\\n)projects\\s*:[\\s\\S]*?(?:^|[\\s,\\[\"'])${escaped}(?:$|[\\s,\\]\"'])`, "m").test(
    frontmatterText,
  )
}

async function deleteProjectState(
  storage: VaultStorage,
  projectId: string,
): Promise<DeleteProjectState> {
  assertProjectId(projectId)
  const routing = await loadRouting(storage)
  const projectDir = routing.project ?? "wiki/projects"
  const path = `${projectDir}/${projectId}.md`
  const raw = await storage.read(path)
  if (raw === null) throw new ProjectNotFoundError(`project not found: ${projectId}`)
  try {
    if (parseDocument(raw).frontmatter.type !== "project") {
      throw new ProjectNotFoundError(`project not found: ${projectId}`)
    }
  } catch (error) {
    if (error instanceof ProjectNotFoundError) throw error
    throw new ProjectNotFoundError(`project not found or corrupt: ${projectId}`)
  }

  const members: DeleteMemberState[] = []
  for (const candidatePath of await storage.list("wiki/")) {
    if (!candidatePath.endsWith(".md") || candidatePath === path) continue
    const candidateRaw = await storage.read(candidatePath)
    if (candidateRaw === null) continue
    try {
      const { frontmatter, body } = parseDocument(candidateRaw)
      const projects = frontmatter.projects === undefined ? [] : stringArray(frontmatter.projects)
      if (projects === null) {
        if (malformedPageMentionsProject(candidateRaw, projectId)) {
          throw new ProjectValidationError(`member page projects must be an array: ${candidatePath}`)
        }
        continue
      }
      if (projects.includes(projectId)) {
        members.push({ path: candidatePath, raw: candidateRaw, frontmatter, body })
      }
    } catch (error) {
      if (error instanceof ProjectValidationError || malformedPageMentionsProject(candidateRaw, projectId)) {
        throw new ProjectValidationError(`project member page is malformed: ${candidatePath}`)
      }
    }
  }
  members.sort((a, b) => a.path.localeCompare(b.path))
  const previewRevision = await revisionOf(
    [[path, raw], ...members.map((member) => [member.path, member.raw])]
      .map(([candidatePath, candidateRaw]) => `${candidatePath}\u0000${candidateRaw}`)
      .join("\u0000"),
  )
  return { path, raw, revision: await revisionOf(raw), previewRevision, members }
}

export async function previewDeleteProject(
  storage: VaultStorage,
  projectId: string,
): Promise<ProjectDeletePreview> {
  const state = await deleteProjectState(storage, projectId)
  return {
    id: projectId,
    revision: state.revision,
    previewRevision: state.previewRevision,
    files: [
      { path: state.path, operation: "delete" },
      ...state.members.map((member) => ({
        path: member.path,
        operation: "update" as const,
      })),
    ],
  }
}

export async function deleteProject(
  storage: VaultStorage,
  projectId: string,
  input: DeleteProjectInput,
): Promise<ProjectMutation<{ id: string; affectedPaths: string[] }>> {
  if (!/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new ProjectValidationError("revision must be a SHA-256 hash")
  }
  if (!/^[a-f0-9]{64}$/.test(input.previewRevision)) {
    throw new ProjectValidationError("previewRevision must be a SHA-256 hash")
  }
  const state = await deleteProjectState(storage, projectId)
  if (state.revision !== input.revision || state.previewRevision !== input.previewRevision) {
    throw new ProjectConflictError(`project deletion preview is stale: ${projectId}`)
  }
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new ProjectValidationError("now must be a valid date")
  const date = now.toISOString().slice(0, 10)
  const changes = [
    { path: state.path, before: state.raw, after: null },
    ...state.members.map((member) => ({
      path: member.path,
      before: member.raw,
      after: serializeDocument(
        {
          ...member.frontmatter,
          projects: (member.frontmatter.projects as string[]).filter((id) => id !== projectId),
          updated: date,
        },
        member.body,
      ),
    })),
  ]
  const changesetId = makeChangesetId()
  const mutation = await commitChangeset(
    storage,
    {
      id: changesetId,
      skill: "project-delete",
      model: "none",
      timestamp: now.toISOString(),
      changes,
    },
    { op: "project-delete", summary: projectId },
  )
  return {
    result: { id: projectId, affectedPaths: changes.map((change) => change.path) },
    changesetId: mutation.changesetId,
    warnings: mutation.warnings,
  }
}
