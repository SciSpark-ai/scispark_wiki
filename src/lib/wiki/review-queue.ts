import type { VaultStorage } from "../vault/storage"
import type { Changeset } from "../vault/types"

/**
 * A review item flagged by the ingest LLM for human judgment.
 * Written by ingest.ts to .scispark/review/{id}.json, or archived to
 * .scispark/review/archived/ when dismissed via dismissReview.
 */
export interface ReviewItem {
  id: string
  createdAt: string // ISO 8601 timestamp
  changesetId: string
  kind: "contradiction" | "duplicate" | "missing-page" | "suggestion"
  title: string
  description: string
  pages: string[] // bare slugs of related wiki pages
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
 * Lists ingest changesets, sorted by timestamp descending (newest first).
 * Reads .scispark/changesets/*.json records and detects reverts by checking
 * log.md for "undo | {changesetId}" entries. Skips corrupt/unparseable changesets.
 */
export async function listIngests(storage: VaultStorage): Promise<IngestRecord[]> {
  const changesetPrefix = ".scispark/changesets/"
  const paths = await storage.list(changesetPrefix)

  // Read log.md once to check for reverts
  const logContent = await storage.read("log.md")
  const revertedIds = new Set<string>()
  if (logContent !== null) {
    // Look for entries like "undo | {changesetId}"
    const revertPattern = /\]\s+undo\s+\|\s+(\S+)/g
    let match
    while ((match = revertPattern.exec(logContent)) !== null) {
      revertedIds.add(match[1])
    }
  }

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
