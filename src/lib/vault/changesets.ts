import type { VaultStorage } from "./storage"
import type { Changeset, FileChange } from "./types"

export class ChangesetConflictError extends Error {
  constructor(public conflicts: string[]) {
    super(`changeset conflicts at: ${conflicts.join(", ")}`)
  }
}

/** Thrown when a changeset is structurally invalid (e.g. duplicate paths,
 * or an id that collides with an already-persisted record). Thrown before
 * any write or conflict check is performed. */
export class ChangesetInvalidError extends Error {}

/** Thrown when applyChangeset fails partway through its write loop. Wraps
 * the original error and reports how much rollback recovery was possible. */
export class ChangesetApplyError extends Error {
  constructor(
    public originalError: unknown,
    public appliedCount: number,
    public rolledBack: boolean,
  ) {
    super(
      `changeset apply failed after ${appliedCount} change(s) applied ` +
        `(rolledBack=${rolledBack}): ${
          originalError instanceof Error ? originalError.message : String(originalError)
        }`,
    )
  }
}

export function makeChangesetId(): string {
  const hex = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0")
  return `cs-${Date.now()}-${hex}`
}

function findDuplicatePaths(changes: FileChange[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const ch of changes) {
    if (seen.has(ch.path)) dupes.add(ch.path)
    seen.add(ch.path)
  }
  return [...dupes]
}

function changesetRecordPath(id: string): string {
  return `.scispark/changesets/${id}.json`
}

export async function applyChangeset(storage: VaultStorage, cs: Changeset): Promise<void> {
  // 1. Structural validation — before any write or conflict check.
  const dupes = findDuplicatePaths(cs.changes)
  if (dupes.length) {
    throw new ChangesetInvalidError(
      `changeset has duplicate changes for path(s): ${dupes.join(", ")}`,
    )
  }

  const recordPath = changesetRecordPath(cs.id)
  const existingRecord = await storage.read(recordPath)
  if (existingRecord !== null) {
    throw new ChangesetInvalidError(
      `changeset id collision: a record already exists at ${recordPath}`,
    )
  }

  // 2. Conflict check — all-or-nothing, before any write.
  const conflicts: string[] = []
  for (const ch of cs.changes) {
    const current = await storage.read(ch.path)
    if (current !== ch.before) conflicts.push(ch.path)
  }
  if (conflicts.length) throw new ChangesetConflictError(conflicts)

  // 3. Apply, tracking what has landed so we can roll back on failure.
  const applied: FileChange[] = []
  try {
    for (const ch of cs.changes) {
      if (ch.after === null) await storage.delete(ch.path)
      else await storage.write(ch.path, ch.after)
      applied.push(ch)
    }
    // 4. Persist the audit record only after all page writes have succeeded.
    // Must be inside the try so a failure here also triggers rollback.
    await storage.write(recordPath, JSON.stringify(cs, null, 2))
  } catch (err) {
    let rolledBack = true
    for (const ch of applied.slice().reverse()) {
      try {
        if (ch.before === null) await storage.delete(ch.path)
        else await storage.write(ch.path, ch.before)
      } catch {
        rolledBack = false
      }
    }
    throw new ChangesetApplyError(err, applied.length, rolledBack)
  }
}

export async function revertChangeset(
  storage: VaultStorage,
  cs: Changeset,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!opts.force) {
    const conflicts: string[] = []
    for (const ch of cs.changes) {
      const current = await storage.read(ch.path)
      if (current !== ch.after) conflicts.push(ch.path)
    }
    if (conflicts.length) throw new ChangesetConflictError(conflicts)
  }

  for (const ch of cs.changes) {
    if (ch.before === null) await storage.delete(ch.path)
    else await storage.write(ch.path, ch.before)
  }
}

export async function loadChangeset(storage: VaultStorage, id: string): Promise<Changeset | null> {
  const raw = await storage.read(changesetRecordPath(id))
  return raw ? (JSON.parse(raw) as Changeset) : null
}
