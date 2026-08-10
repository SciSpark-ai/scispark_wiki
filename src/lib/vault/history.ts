import {
  ChangesetInvalidError,
  ChangesetNotFoundError,
  classifyChangeset,
  loadChangeset,
  type ChangesetStatus,
} from "./changesets"
import type { VaultStorage } from "./storage"
import type { FileChange } from "./types"

const CHANGESET_AUDIT_PREFIX = ".scispark/changesets/"

export type ChangeOperation = "create" | "update" | "delete"

export interface ChangesetHistoryFile {
  path: string
  operation: ChangeOperation
}

export interface ChangesetHistoryRecord {
  changesetId: string
  timestamp: string
  skill: string
  model: string
  status: ChangesetStatus
  files: ChangesetHistoryFile[]
  divergedPaths: string[]
}

export interface ChangesetHistoryPreview extends ChangesetHistoryRecord {
  changes: FileChange[]
}

export async function getChangesetPreview(
  storage: VaultStorage,
  changesetId: string,
): Promise<ChangesetHistoryPreview> {
  const changeset = await loadChangeset(storage, changesetId)
  if (changeset === null) {
    throw new ChangesetNotFoundError(`changeset not found or corrupt: ${changesetId}`)
  }
  const classification = await classifyChangeset(storage, changeset)
  return {
    changesetId: changeset.id,
    timestamp: changeset.timestamp,
    skill: changeset.skill,
    model: changeset.model,
    status: classification.status,
    files: changeset.changes.map((change) => ({
      path: change.path,
      operation:
        change.before === null
          ? "create"
          : change.after === null
            ? "delete"
            : "update",
    })),
    divergedPaths: classification.divergedPaths,
    changes: changeset.changes,
  }
}

/**
 * Builds a safe History view from immutable audit records plus the live vault.
 * Corrupt records are omitted so one bad file cannot crash the entire page.
 * File contents are deliberately never returned.
 */
export async function listChangesetHistory(
  storage: VaultStorage,
): Promise<ChangesetHistoryRecord[]> {
  const paths = await storage.list(CHANGESET_AUDIT_PREFIX)
  const records: ChangesetHistoryRecord[] = []

  for (const path of paths) {
    if (!path.endsWith(".json")) continue
    const id = path.slice(CHANGESET_AUDIT_PREFIX.length, -".json".length)

    try {
      const changeset = await loadChangeset(storage, id)
      if (changeset === null) continue

      const classification = await classifyChangeset(storage, changeset)
      records.push({
        changesetId: changeset.id,
        timestamp: changeset.timestamp,
        skill: changeset.skill,
        model: changeset.model,
        status: classification.status,
        files: changeset.changes.map((change) => ({
          path: change.path,
          operation:
            change.before === null
              ? "create"
              : change.after === null
                ? "delete"
                : "update",
        })),
        divergedPaths: classification.divergedPaths,
      })
    } catch (error) {
      if (error instanceof ChangesetInvalidError) continue
      throw error
    }
  }

  return records.sort(
    (a, b) =>
      Date.parse(b.timestamp) - Date.parse(a.timestamp) ||
      a.changesetId.localeCompare(b.changesetId),
  )
}
