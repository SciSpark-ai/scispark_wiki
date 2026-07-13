import type { VaultStorage } from "../vault/storage"

/**
 * Companion settings — stored under a top-level "companion" key in
 * `.scispark/settings.json`, a sibling of the M2 "llm" key (see
 * src/lib/llm/settings.ts). Mirrors that loader's merge/read-modify-write
 * discipline: reading tolerates a missing file/section, and saving never
 * clobbers sibling top-level keys.
 */

const SETTINGS_PATH = ".scispark/settings.json"

export type Chattiness = "off" | "low" | "medium" | "high"

export interface CompanionSettings {
  chattiness: Chattiness
}

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  chattiness: "medium",
}

/** Max proactive interventions allowed per session for a chattiness level. */
export const SESSION_BUDGET: Record<Chattiness, number> = {
  off: 0,
  low: 2,
  medium: 5,
  high: 10,
}

async function readJsonFile(storage: VaultStorage): Promise<Record<string, unknown>> {
  const raw = await storage.read(SETTINGS_PATH)
  if (raw == null) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function loadCompanionSettings(storage: VaultStorage): Promise<CompanionSettings> {
  const file = await readJsonFile(storage)
  const companion = (
    file.companion !== null && typeof file.companion === "object" ? file.companion : {}
  ) as Partial<CompanionSettings>

  return {
    ...DEFAULT_COMPANION_SETTINGS,
    ...companion,
  }
}

// Serializes .scispark/settings.json read-modify-write cycles across every
// saveCompanionSettings() call sharing a VaultStorage instance, mirroring the
// write-queue pattern in src/lib/events/log.ts. Keyed by storage instance
// identity — one queue per browser tab/process.
const settingsWriteQueues = new WeakMap<VaultStorage, Promise<void>>()

export async function saveCompanionSettings(storage: VaultStorage, settings: CompanionSettings): Promise<void> {
  const previous = settingsWriteQueues.get(storage) ?? Promise.resolve()
  const work = async (): Promise<void> => {
    const file = await readJsonFile(storage)
    const next = { ...file, companion: settings }
    await storage.write(SETTINGS_PATH, JSON.stringify(next, null, 2))
  }
  const thisWrite = previous.then(work)
  const queueTail = thisWrite.then(
    () => undefined,
    () => undefined,
  )
  settingsWriteQueues.set(storage, queueTail)
  await thisWrite
}
