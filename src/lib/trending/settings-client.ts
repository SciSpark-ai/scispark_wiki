import type { TrendingSettings } from "./settings"
import type { SettingsResponse } from "@/app/api/settings/route"
import { errorMessageFor } from "@/lib/llm/settings-client"

/**
 * Browser-side trending settings, read/written through `/api/settings` (M12
 * follow-up). The generic vault-file route 403s `.scispark/settings.json`, so
 * the browser can't touch trending settings via `RemoteVaultStorage`; this
 * mirrors `llm/settings-client.ts` — the server route owns the file, the
 * client just fetches. Server-side code keeps calling
 * `loadTrendingSettings`/`saveTrendingSettings` on its own vault directly.
 */

/** Fetches the server-held trending settings (tracked fields + cadence). */
export async function loadTrendingSettingsRemote(
  fetchFn: typeof fetch = fetch,
): Promise<TrendingSettings> {
  const res = await fetchFn("/api/settings", { method: "GET" })
  if (!res.ok) throw new Error(await errorMessageFor(res))
  const body = (await res.json()) as SettingsResponse
  return body.trending
}

/** Replaces the server-held trending settings and returns the stored view. */
export async function saveTrendingSettingsRemote(
  settings: TrendingSettings,
  fetchFn: typeof fetch = fetch,
): Promise<TrendingSettings> {
  const res = await fetchFn("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trending: settings }),
  })
  if (!res.ok) throw new Error(await errorMessageFor(res))
  const body = (await res.json()) as SettingsResponse
  return body.trending
}
