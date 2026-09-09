import type { VaultStorage } from "./storage"
import type { Changeset, FileChange } from "./types"
import { isSafeVaultRelativePath } from "./safe-path"
import { RESERVED_FILES } from "./types"

const CHANGESET_AUDIT_PREFIX = ".scispark/changesets/"
const CHANGESET_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
const changesetMutationQueues = new WeakMap<VaultStorage, Promise<void>>()

async function withChangesetMutation<T>(
  storage: VaultStorage,
  work: () => Promise<T>,
): Promise<T> {
  const previous = changesetMutationQueues.get(storage) ?? Promise.resolve()
  const current = previous.then(work)
  changesetMutationQueues.set(
    storage,
    current.then(() => undefined, () => undefined),
  )
  return current
}

function findProtectedPaths(changes: FileChange[]): string[] {
  const protectedPaths = new Set<string>()
  for (const ch of changes) {
    // macOS vaults are commonly case-insensitive: mixed-case aliases must not
    // bypass the server-owned settings, billing and review-job boundary.
    const normalized = ch.path.toLowerCase()
    if (
      (RESERVED_FILES as readonly string[]).some((path) => path.toLowerCase() === normalized) ||
      normalized === ".scispark" || normalized.startsWith(".scispark/")
    ) {
      protectedPaths.add(ch.path)
    }
  }
  return [...protectedPaths]
}

export class ChangesetConflictError extends Error {
  constructor(public conflicts: string[]) {
    super(`changeset conflicts at: ${conflicts.join(", ")}`)
  }
}

/** Thrown when a changeset is structurally invalid (e.g. duplicate paths,
 * or an id that collides with an already-persisted record). Thrown before
 * any write or conflict check is performed. */
export class ChangesetInvalidError extends Error {}

export class ChangesetNotFoundError extends Error {}

export class ChangesetStateError extends Error {
  constructor(public classification: ChangesetClassification) {
    super(`changeset is ${classification.status}, not applied`)
  }
}

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

/** Thrown when revert fails partway through and reports whether the already-
 * reverted files were restored to their after-states. */
export class ChangesetRevertError extends Error {
  constructor(
    public originalError: unknown,
    public revertedCount: number,
    public rolledBack: boolean,
  ) {
    super(
      `changeset revert failed after ${revertedCount} change(s) reverted ` +
        `(rolledBack=${rolledBack}): ${
          originalError instanceof Error ? originalError.message : String(originalError)
        }`,
    )
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

/** Runtime boundary for client-submitted and persisted changesets. */
export function parseChangeset(value: unknown): Changeset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChangesetInvalidError("changeset must be an object")
  }
  const candidate = value as Record<string, unknown>
  if (!hasExactKeys(candidate, ["id", "skill", "model", "timestamp", "changes"])) {
    throw new ChangesetInvalidError("changeset contains missing or unknown fields")
  }
  if (
    typeof candidate.id !== "string" ||
    !CHANGESET_ID_RE.test(candidate.id) ||
    typeof candidate.skill !== "string" ||
    candidate.skill.trim() === "" ||
    typeof candidate.model !== "string" ||
    candidate.model.trim() === "" ||
    typeof candidate.timestamp !== "string" ||
    !ISO_TIMESTAMP_RE.test(candidate.timestamp) ||
    !Number.isFinite(Date.parse(candidate.timestamp)) ||
    !Array.isArray(candidate.changes) ||
    candidate.changes.length === 0
  ) {
    throw new ChangesetInvalidError("changeset has invalid metadata or an empty changes list")
  }

  for (const rawChange of candidate.changes) {
    if (typeof rawChange !== "object" || rawChange === null || Array.isArray(rawChange)) {
      throw new ChangesetInvalidError("changeset contains an invalid file change")
    }
    const change = rawChange as Record<string, unknown>
    if (!hasExactKeys(change, ["path", "before", "after"])) {
      throw new ChangesetInvalidError("file change contains missing or unknown fields")
    }
    if (
      typeof change.path !== "string" ||
      change.path.trim() === "" ||
      !isSafeVaultRelativePath(change.path) ||
      !isNullableString(change.before) ||
      !isNullableString(change.after) ||
      change.before === change.after
    ) {
      throw new ChangesetInvalidError("changeset contains an invalid file change")
    }
  }

  const changeset = candidate as unknown as Changeset
  const protectedPaths = findProtectedPaths(changeset.changes)
  if (protectedPaths.length > 0) {
    throw new ChangesetInvalidError(
      `changeset targets protected path(s): ${protectedPaths.join(", ")}`,
    )
  }
  const dupes = findDuplicatePaths(changeset.changes)
  if (dupes.length > 0) {
    throw new ChangesetInvalidError(
      `changeset has duplicate changes for path(s): ${dupes.join(", ")}`,
    )
  }

  return changeset
}

export function makeChangesetId(): string {
  const hex = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0")
  return `cs-${Date.now()}-${hex}`
}

export type ChangesetStatus = "applied" | "reverted" | "diverged"

export interface ChangesetClassification {
  status: ChangesetStatus
  /** Paths that prevent a safe undo because their current content is not the
   * changeset's recorded after-state. Populated only for `diverged`. */
  divergedPaths: string[]
}

/** Derives history state from the current files rather than trusting log.md. */
export async function classifyChangeset(
  storage: VaultStorage,
  cs: Changeset,
): Promise<ChangesetClassification> {
  const current = await Promise.all(cs.changes.map((change) => storage.read(change.path)))
  const allAfter = cs.changes.every((change, index) => current[index] === change.after)
  if (allAfter) return { status: "applied", divergedPaths: [] }

  const allBefore = cs.changes.every((change, index) => current[index] === change.before)
  if (allBefore) return { status: "reverted", divergedPaths: [] }

  return {
    status: "diverged",
    divergedPaths: cs.changes
      .filter((change, index) => current[index] !== change.after)
      .map((change) => change.path),
  }
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
  if (!CHANGESET_ID_RE.test(id)) {
    throw new ChangesetInvalidError(`invalid changeset id: ${id}`)
  }
  return `${CHANGESET_AUDIT_PREFIX}${id}.json`
}

async function applyChangesetUnlocked(storage: VaultStorage, cs: Changeset): Promise<void> {
  parseChangeset(cs)
  // 1. Structural validation happens in parseChangeset before any read/write.
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
    if (rolledBack) {
      try {
        await storage.delete(recordPath)
      } catch {
        rolledBack = false
      }
    }
    throw new ChangesetApplyError(err, applied.length, rolledBack)
  }
}

export async function applyChangeset(storage: VaultStorage, cs: Changeset): Promise<void> {
  return withChangesetMutation(storage, () => applyChangesetUnlocked(storage, cs))
}

async function revertChangesetUnlocked(
  storage: VaultStorage,
  cs: Changeset,
): Promise<void> {
  parseChangeset(cs)
  const conflicts: string[] = []
  for (const ch of cs.changes) {
    const current = await storage.read(ch.path)
    if (current !== ch.after) conflicts.push(ch.path)
  }
  if (conflicts.length) throw new ChangesetConflictError(conflicts)

  const reverted: FileChange[] = []
  try {
    for (const ch of cs.changes) {
      if (ch.before === null) await storage.delete(ch.path)
      else await storage.write(ch.path, ch.before)
      reverted.push(ch)
    }
  } catch (err) {
    let rolledBack = true
    for (const ch of reverted.slice().reverse()) {
      try {
        if (ch.after === null) await storage.delete(ch.path)
        else await storage.write(ch.path, ch.after)
      } catch {
        rolledBack = false
      }
    }
    throw new ChangesetRevertError(err, reverted.length, rolledBack)
  }
}

export async function revertChangeset(
  storage: VaultStorage,
  cs: Changeset,
): Promise<void> {
  return withChangesetMutation(storage, () => revertChangesetUnlocked(storage, cs))
}

export async function loadChangeset(storage: VaultStorage, id: string): Promise<Changeset | null> {
  const raw = await storage.read(changesetRecordPath(id))
  if (raw === null) return null
  try {
    const changeset = parseChangeset(JSON.parse(raw))
    return changeset.id === id ? changeset : null
  } catch {
    return null
  }
}

/** Safe undo boundary: resolves the immutable audit record by id, verifies its
 * live content-derived state, and never accepts file contents from a caller. */
export async function revertPersistedChangeset(storage: VaultStorage, id: string): Promise<Changeset> {
  return withChangesetMutation(storage, async () => {
    const changeset = await loadChangeset(storage, id)
    if (changeset === null) {
      throw new ChangesetNotFoundError(`changeset not found or corrupt: ${id}`)
    }

    const classification = await classifyChangeset(storage, changeset)
    if (classification.status !== "applied") throw new ChangesetStateError(classification)

    await revertChangesetUnlocked(storage, changeset)
    return changeset
  })
}
