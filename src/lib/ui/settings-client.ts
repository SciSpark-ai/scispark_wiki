import { DEFAULT_UI_SETTINGS, normalizeUiSettings, type ThemeMode, type UiSettings } from "./settings"
import type { SettingsResponse } from "@/app/api/settings/route"
import { errorMessageFor } from "@/lib/llm/settings-client"

/**
 * Browser-side ui settings, read/written through `/api/settings` (mirrors
 * `companion/settings-client.ts` / `trending/settings-client.ts`). The
 * generic vault-file route 403s `.scispark/settings.json`, so the browser
 * can't touch ui settings via `RemoteVaultStorage`; the server route owns
 * the file, the client just fetches.
 */

/** Fetches the server-held ui settings (theme mode). Degrades to the default
 * on a failed response rather than throwing — theme is a rendering nicety,
 * not something that should block the app on a transient fetch failure. */
export async function loadUiSettingsRemote(fetchFn: typeof fetch = fetch): Promise<UiSettings> {
  const res = await fetchFn("/api/settings", { method: "GET" })
  if (!res.ok) return { ...DEFAULT_UI_SETTINGS }
  const body = (await res.json()) as SettingsResponse
  return normalizeUiSettings(body.ui)
}

/** Replaces the server-held ui settings. */
export async function saveUiSettingsRemote(ui: UiSettings, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ui }),
  })
  if (!res.ok) throw new Error(await errorMessageFor(res))
}

/** Applies a theme mode to the document and mirrors it for the FOUC boot
 * script (see src/app/layout.tsx's THEME_INIT_SCRIPT, which reads the same
 * localStorage key before React hydrates). */
export function applyTheme(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  if (dark) document.documentElement.dataset.theme = "dark"
  else delete document.documentElement.dataset.theme
  try {
    localStorage.setItem("scispark-theme", mode)
  } catch {
    // storage unavailable (private mode) — theme still applies for this page
  }
}
