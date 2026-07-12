export const PAGE_TYPES = [
  "paper", "concept", "method", "finding", "comparison",
  "author", "topic", "note", "idea", "project",
] as const
export type PageType = (typeof PAGE_TYPES)[number]

export const RESERVED_FILES = ["purpose.md", "schema.md", "index.md", "log.md"] as const

export interface Frontmatter {
  type: string
  title: string
  created: string
  updated: string
  tags: string[]
  related: string[]
  sources: string[]
  [key: string]: unknown
}

export interface WikiPage {
  id: string      // vault-relative path minus .md, e.g. "wiki/concepts/sparse-autoencoders"
  path: string    // vault-relative path, e.g. "wiki/concepts/sparse-autoencoders.md"
  frontmatter: Frontmatter
  body: string
}

export interface FileChange {
  path: string
  before: string | null  // null = file did not exist
  after: string | null   // null = file deleted
}

export interface Changeset {
  id: string
  skill: string
  model: string
  timestamp: string  // ISO 8601
  changes: FileChange[]
}
