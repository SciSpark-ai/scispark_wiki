import { logEvent } from "../events/log"
import { loadBundle } from "./bundle"
import { applyChangeset, revertPersistedChangeset } from "./changesets"
import { appendLog, writeIndex } from "./index-builder"
import type { VaultStorage } from "./storage"
import type { Changeset } from "./types"

const mutationCoordinatorQueues = new WeakMap<VaultStorage, Promise<void>>()

async function withMutationCoordinator<T>(
  storage: VaultStorage,
  work: () => Promise<T>,
): Promise<T> {
  const previous = mutationCoordinatorQueues.get(storage) ?? Promise.resolve()
  const current = previous.then(work)
  mutationCoordinatorQueues.set(
    storage,
    current.then(() => undefined, () => undefined),
  )
  return current
}

export type MutationWarningCode = "index-refresh-failed" | "log-append-failed"

export interface MutationWarning {
  code: MutationWarningCode
  message: string
}

export interface ChangesetMutationResult {
  changesetId: string
  warnings: MutationWarning[]
}

export interface MutationLogEntry {
  timestamp?: string
  op?: string
  summary?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function refreshDerivedData(
  storage: VaultStorage,
  changeset: Changeset,
  log: MutationLogEntry,
): Promise<MutationWarning[]> {
  const warnings: MutationWarning[] = []

  try {
    await writeIndex(storage, await loadBundle(storage))
  } catch (error) {
    warnings.push({
      code: "index-refresh-failed",
      message: `The vault mutation succeeded, but index.md could not be refreshed: ${errorMessage(error)}`,
    })
  }

  try {
    const timestamp = log.timestamp ?? changeset.timestamp
    await appendLog(storage, {
      date: timestamp.slice(0, 10),
      op: log.op ?? changeset.skill,
      summary: log.summary ?? changeset.id,
    })
  } catch (error) {
    warnings.push({
      code: "log-append-failed",
      message: `The vault mutation succeeded, but log.md could not be updated: ${errorMessage(error)}`,
    })
  }

  return warnings
}

/**
 * Applies an atomic changeset and then refreshes derived vault data. A derived
 * refresh failure is returned as a warning because the primary mutation has
 * already committed and retrying the request would be ambiguous.
 */
export async function commitChangeset(
  storage: VaultStorage,
  changeset: Changeset,
  log: MutationLogEntry = {},
): Promise<ChangesetMutationResult> {
  return withMutationCoordinator(storage, async () => {
    await applyChangeset(storage, changeset)
    const warnings = await refreshDerivedData(storage, changeset, log)
    return { changesetId: changeset.id, warnings }
  })
}

/** Safe global undo: resolves file contents from a persisted changeset id only. */
export async function undoChangeset(
  storage: VaultStorage,
  changesetId: string,
  log: MutationLogEntry = {},
): Promise<ChangesetMutationResult> {
  return withMutationCoordinator(storage, async () => {
    const changeset = await revertPersistedChangeset(storage, changesetId)
    await logEvent(storage, { type: "changeset_revert", changesetId, skill: changeset.skill },
      log.timestamp ? () => new Date(log.timestamp!) : undefined)
    const warnings = await refreshDerivedData(storage, changeset, {
      ...log,
      op: log.op ?? "undo",
      summary: log.summary ?? changesetId,
    })
    return { changesetId, warnings }
  })
}
