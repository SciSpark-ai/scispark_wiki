/**
 * UI settings — a `theme` mode (system/light/dark), stored under a top-level
 * "ui" key in `.scispark/settings.json`, a sibling of the "llm"/"companion"/
 * "trending" keys (see src/lib/llm/settings.ts).
 *
 * Deliberately pure: unlike companion/trending, this module holds NO
 * storage-backed loader/saver. Theme has no server-side orchestrator that
 * needs it (it's a pure rendering concern), so there is nothing here for the
 * browser-purity gate to ban — the whole module (types, DEFAULT_UI_SETTINGS,
 * normalizeUiSettings) is safe to import from client code. `/api/settings`
 * reads/writes the raw `ui` field itself and normalizes through this module.
 */

export type ThemeMode = "system" | "light" | "dark"

export interface UiSettings {
  theme: ThemeMode
}

export const DEFAULT_UI_SETTINGS: UiSettings = { theme: "system" }

const MODES: ReadonlySet<string> = new Set(["system", "light", "dark"])

/** Tolerant normalizer for the `ui` sub-object of .scispark/settings.json —
 * mirrors normalizeCompanionSettings/normalizeTrendingSettings. */
export function normalizeUiSettings(raw: unknown): UiSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_UI_SETTINGS }
  const theme = (raw as { theme?: unknown }).theme
  return { theme: typeof theme === "string" && MODES.has(theme) ? (theme as ThemeMode) : DEFAULT_UI_SETTINGS.theme }
}
