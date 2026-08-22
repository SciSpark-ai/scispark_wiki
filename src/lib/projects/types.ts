import type { MutationWarning } from "../vault/mutations"

export interface ProjectMember {
  id: string
  path: string
  title: string
  type: string
  revision: string
}

export interface ProjectConversation {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

export interface ProjectCounts {
  members: number
  papers: number
  notes: number
  conversations: number
}

export interface ProjectSummary {
  id: string
  title: string
  description: string
  instructions: string
  revision: string
  createdAt: string
  updatedAt: string
  members: ProjectMember[]
  conversations: ProjectConversation[]
  counts: ProjectCounts
}

export interface ProjectDetail extends ProjectSummary {
  overview: string
}

export interface ProjectMutation<T> {
  result: T
  changesetId: string
  warnings: MutationWarning[]
}

export interface CreateProjectInput {
  title: string
  description: string
  instructions: string
  overview: string
  now?: Date
}

export interface UpdateProjectInput {
  revision: string
  title: string
  description: string
  instructions: string
  overview: string
  now?: Date
}

export interface ProjectMembershipInput {
  pageId: string
  revision: string
  now?: Date
}

export interface ProjectNote {
  id: string
  projectId: string
  title: string
  content: string
  sources: string[]
  revision: string
  createdAt: string
  updatedAt: string
}

export interface CreateProjectNoteInput {
  title: string
  content: string
  sources: string[]
  now?: Date
}

export interface UpdateProjectNoteInput {
  revision: string
  title: string
  content: string
  now?: Date
}

export interface DeleteProjectNoteInput {
  revision: string
  now?: Date
}

export interface ProjectDeletePreview {
  id: string
  revision: string
  previewRevision: string
  files: Array<{ path: string; operation: "update" | "delete" }>
}

export interface DeleteProjectInput {
  revision: string
  previewRevision: string
  now?: Date
}
