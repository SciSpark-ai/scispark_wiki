import type { VaultStorage } from "./storage"

const SETTINGS_PATH = ".scispark/settings.json"

// One shared serialization chain per storage instance for the single
// .scispark/settings.json file. Before M12, llm/companion/trending each
// owned (or lacked) their own queue, so concurrent cross-module saves could
// lost-update each other's top-level key. Keyed by storage identity.
const settingsWriteQueue = new WeakMap<VaultStorage, Promise<void>>()

async function readFile(storage: VaultStorage): Promise<Record<string, unknown>> {
  const raw = await storage.read(SETTINGS_PATH)
  if (raw == null) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Serialized read-modify-write of the whole settings file. `mutate` receives the
 * parsed file object and returns the new file object (preserve siblings). */
export async function withSettingsWrite(
  storage: VaultStorage,
  mutate: (file: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const previous = settingsWriteQueue.get(storage) ?? Promise.resolve()
  const work = async (): Promise<void> => {
    const file = await readFile(storage)
    const next = mutate(file)
    await storage.write(SETTINGS_PATH, JSON.stringify(next, null, 2))
  }
  const thisWrite = previous.then(work)
  settingsWriteQueue.set(
    storage,
    thisWrite.then(() => undefined, () => undefined),
  )
  await thisWrite
}
