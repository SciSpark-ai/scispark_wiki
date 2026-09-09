import type { VaultStorage } from "./storage"

const queues = new WeakMap<VaultStorage, Map<string, Promise<unknown>>>()
/** The in-memory fallback is for injected test storage, not production job ownership. */
export function withVaultExclusive<T>(storage: VaultStorage, name: string, work: () => Promise<T>): Promise<T> {
  if (storage.exclusive) return storage.exclusive(name, work)
  let names = queues.get(storage)
  if (!names) { names = new Map(); queues.set(storage, names) }
  const next = (names.get(name) ?? Promise.resolve()).catch(() => undefined).then(work)
  names.set(name, next.catch(() => undefined))
  return next
}
