import type { VaultStorage } from "./storage"
import type { Changeset } from "./types"

export class ChangesetConflictError extends Error {
  constructor(public conflicts: string[]) {
    super(`changeset conflicts at: ${conflicts.join(", ")}`)
  }
}

export function makeChangesetId(): string {
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")
  return `cs-${Date.now()}-${hex}`
}

export async function applyChangeset(storage: VaultStorage, cs: Changeset): Promise<void> {
  const conflicts: string[] = []
  for (const ch of cs.changes) {
    const current = await storage.read(ch.path)
    if (current !== ch.before) conflicts.push(ch.path)
  }
  if (conflicts.length) throw new ChangesetConflictError(conflicts)

  for (const ch of cs.changes) {
    if (ch.after === null) await storage.delete(ch.path)
    else await storage.write(ch.path, ch.after)
  }
  await storage.write(`.scispark/changesets/${cs.id}.json`, JSON.stringify(cs, null, 2))
}

export async function revertChangeset(storage: VaultStorage, cs: Changeset): Promise<void> {
  for (const ch of cs.changes) {
    if (ch.before === null) await storage.delete(ch.path)
    else await storage.write(ch.path, ch.before)
  }
}

export async function loadChangeset(storage: VaultStorage, id: string): Promise<Changeset | null> {
  const raw = await storage.read(`.scispark/changesets/${id}.json`)
  return raw ? (JSON.parse(raw) as Changeset) : null
}
