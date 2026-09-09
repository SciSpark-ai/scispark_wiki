import type { VaultStorage } from "../vault/storage"
import type { Changeset, FileChange } from "../vault/types"
import type { LintKind } from "../lint/types"

/**
 * A review item flagged by the ingest LLM for human judgment, or by the lint
 * orchestrator (src/lib/lint/run.ts) for a deterministic/LLM lint finding.
 * Written by ingest.ts or lint/run.ts to .scispark/review/{id}.json, or
 * archived to .scispark/review/archived/ when dismissed via dismissReview.
 */
export interface ReviewItem {
  id: string
  createdAt: string // ISO 8601 timestamp
  /**
   * The ingest changeset that produced this item, including automatic
   * post-ingest lint findings. Independent manual/scheduled lint has no
   * producing changeset. This is not the changeset for applying a lint fix.
   */
  changesetId?: string
  kind: "contradiction" | "duplicate" | "missing-page" | "suggestion" | "lint-finding"
  title: string
  description: string
  pages: string[] // bare slugs of related wiki pages
  /** Present only for kind "lint-finding": which check produced it (src/lib/lint/types.ts). */
  lintKind?: LintKind
  /**
   * Present only for kind "lint-finding" items whose page can carry multiple
   * same-`lintKind` findings (broken-link: the broken slug). Lets applyLintFix
   * (src/lib/lint/run.ts) re-find the EXACT finding when it recomputes checks
   * at apply time — see LintFinding.fixTarget (src/lib/lint/types.ts).
   */
  fixTarget?: string
  /**
   * Present only for kind "lint-finding" items with a mechanical fix
   * (src/lib/lint/types.ts#LintFinding.fix) — what applyLintFix
   * (src/lib/lint/run.ts) will apply as a one-file changeset.
   */
  fix?: { path: string; before: string | null; after: string }
  /**
   * Present only for kind "lint-finding" items whose mechanical fix touches
   * MORE than one file (src/lib/lint/types.ts#LintFinding.fixes) — what
   * applyLintFix will apply as one atomic multi-file changeset. Mutually
   * exclusive with `fix` above.
   */
  fixes?: FileChange[]
}

/**
 * Lists all active review items, sorted by createdAt descending (newest first),
 * then by id. Skips files that fail to parse as JSON — tolerant of corruption.
 */
export async function listReviews(storage: VaultStorage): Promise<ReviewItem[]> {
  const reviewPrefix = ".scispark/review/"
  const archivedPrefix = `${reviewPrefix}archived/`
  const paths = await storage.list(reviewPrefix)

  const items: ReviewItem[] = []
  for (const path of paths) {
    // Skip archived reviews
    if (path.startsWith(archivedPrefix)) continue

    const content = await storage.read(path)
    if (content === null) continue

    try {
      const item = JSON.parse(content) as ReviewItem
      items.push(item)
    } catch {
      // Skip corrupt/unparseable files
    }
  }

  // Sort by createdAt desc, then id
  items.sort((a, b) => {
    const timeCompare = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    if (timeCompare !== 0) return timeCompare
    return b.id.localeCompare(a.id)
  })

  return items
}

/**
 * Moves a review item from active to archived, making it no longer appear
 * in listReviews. The file is written to .scispark/review/archived/ and
 * deleted from the active location. Missing ids are a no-op.
 */
export async function dismissReview(storage: VaultStorage, id: string): Promise<void> {
  const reviewPrefix = ".scispark/review/"
  const archivedPrefix = `${reviewPrefix}archived/`

  // Find the active review file with this id
  const paths = await storage.list(reviewPrefix)
  let activePath: string | null = null
  for (const path of paths) {
    if (path.startsWith(archivedPrefix)) continue
    if (path.endsWith(`${id}.json`)) {
      activePath = path
      break
    }
  }

  if (activePath === null) {
    // Id doesn't exist — no-op
    return
  }

  const content = await storage.read(activePath)
  if (content === null) {
    // File was deleted between list and read — no-op
    return
  }

  const filename = activePath.slice(reviewPrefix.length)
  const archivedPath = `${archivedPrefix}${filename}`

  await storage.write(archivedPath, content)
  await storage.delete(activePath)
}

/**
 * Returns the count of active review items (same scope as listReviews).
 */
export async function reviewCount(storage: VaultStorage): Promise<number> {
  return (await listReviews(storage)).length
}

/**
 * Information about an ingest changeset, including metadata and whether
 * it has been reverted (undone).
 */
export interface IngestRecord {
  changesetId: string
  timestamp: string // ISO 8601
  skill: string
  model: string
  files: number
  reverted?: boolean
}

/**
 * Extracts the set of changeset ids that have an "undo | {changesetId}" entry
 * in `log.md` (the entry `undoIngest` — src/lib/skills/ingest.ts — appends via
 * `appendLog`). Tolerant of any other log.md content; an empty/missing log
 * yields an empty set.
 */
export function parseUndoneChangesetIds(logMd: string): Set<string> {
  const revertedIds = new Set<string>()
  const revertPattern = /\]\s+undo\s+\|\s+(\S+)/g
  let match
  while ((match = revertPattern.exec(logMd)) !== null) {
    revertedIds.add(match[1])
  }
  return revertedIds
}

/**
 * Lists ingest changesets, sorted by timestamp descending (newest first).
 * Reads .scispark/changesets/*.json records and detects reverts by checking
 * log.md for "undo | {changesetId}" entries. Skips corrupt/unparseable changesets.
 */
export async function listIngests(storage: VaultStorage): Promise<IngestRecord[]> {
  const changesetPrefix = ".scispark/changesets/"
  const paths = await storage.list(changesetPrefix)

  // Read log.md once to check for reverts
  const logContent = await storage.read("log.md")
  const revertedIds = parseUndoneChangesetIds(logContent ?? "")

  const records: IngestRecord[] = []
  for (const path of paths) {
    const content = await storage.read(path)
    if (content === null) continue

    try {
      const cs = JSON.parse(content) as Changeset
      const record: IngestRecord = {
        changesetId: cs.id,
        timestamp: cs.timestamp,
        skill: cs.skill,
        model: cs.model,
        files: cs.changes.length,
      }
      if (revertedIds.has(cs.id)) {
        record.reverted = true
      }
      records.push(record)
    } catch {
      // Skip corrupt/unparseable files
    }
  }

  // Sort by timestamp desc (newest first)
  records.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })

  return records
}
