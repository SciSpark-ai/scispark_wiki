export const LEGACY_PROTOTYPE_KEYS = [
  "scispark-notes",
  "scispark-project-papers",
  "scispark-paper-actions",
] as const

const WARNING_SEEN_KEY = "scispark-legacy-prototype-warning-seen-v1"

export function detectLegacyPrototypeData(storage: Storage): string[] {
  if (storage.getItem(WARNING_SEEN_KEY) === "1") return []
  return LEGACY_PROTOTYPE_KEYS.filter((key) => storage.getItem(key) !== null)
}
export function markLegacyPrototypeWarningSeen(storage: Storage): void {
  storage.setItem(WARNING_SEEN_KEY, "1")
}

export function clearLegacyPrototypeData(storage: Storage): void {
  for (const key of LEGACY_PROTOTYPE_KEYS) storage.removeItem(key)
  markLegacyPrototypeWarningSeen(storage)
}
