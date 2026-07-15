import type { CompanionSettings } from "./settings"
import type { SettingsResponse } from "@/app/api/settings/route"
import { errorMessageFor } from "@/lib/llm/settings-client"

/**
 * Browser-side companion settings, read/written through `/api/settings` (M12
 * follow-up). The generic vault-file route 403s `.scispark/settings.json`, so
 * the browser can't touch companion settings via `RemoteVaultStorage`; this
 * mirrors `llm/settings-client.ts` — the server route owns the file, the
 * client just fetches. Server-side code keeps calling
 * `loadCompanionSettings`/`saveCompanionSettings` on its own vault directly.
 */

/** Fetches the server-held companion settings (name + chattiness). */
export async function loadCompanionSettingsRemote(
  fetchFn: typeof fetch = fetch,
): Promise<CompanionSettings> {
  const res = await fetchFn("/api/settings", { method: "GET" })
  if (!res.ok) throw new Error(await errorMessageFor(res))
  const body = (await res.json()) as SettingsResponse
  return body.companion
}

/** Replaces the server-held companion settings and returns the stored view. */
export async function saveCompanionSettingsRemote(
  settings: CompanionSettings,
  fetchFn: typeof fetch = fetch,
): Promise<CompanionSettings> {
  const res = await fetchFn("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companion: settings }),
  })
  if (!res.ok) throw new Error(await errorMessageFor(res))
  const body = (await res.json()) as SettingsResponse
  return body.companion
}
