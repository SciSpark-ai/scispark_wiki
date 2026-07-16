import type { LLMSettings } from "./settings"
import type { RedactedSettings } from "@/app/api/settings/route"

export type { RedactedSettings } from "@/app/api/settings/route"

/** Partial LLMSettings sent to PUT /api/settings. A key value replaces the
 * stored key; `""` deletes it; an omitted provider is left untouched. */
export type SettingsPatch = Partial<LLMSettings>

/** Extracts a human-readable error from a failed `/api/settings` response —
 * the JSON `{error}` body when present, otherwise the status text. Shared by
 * the companion/trending settings clients (same route, same error shape). */
export async function errorMessageFor(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (parsed && typeof parsed.error === "string") return parsed.error
    } catch {
      // not JSON — fall through to status text
    }
  }
  return res.statusText || `request failed with status ${res.status}`
}

/** Fetches the server-held LLM settings — keys arrive redacted
 * (`{present: true}`), never as raw strings. */
export async function loadRedactedSettings(fetchFn: typeof fetch = fetch): Promise<RedactedSettings> {
  const res = await fetchFn("/api/settings", { method: "GET" })
  if (!res.ok) throw new Error(await errorMessageFor(res))
  const { settings } = (await res.json()) as { settings: RedactedSettings }
  return settings
}

/** Sends a partial-update patch to the server-held LLM settings and returns
 * the resulting redacted view. */
export async function patchSettings(
  patch: SettingsPatch,
  fetchFn: typeof fetch = fetch,
): Promise<RedactedSettings> {
  const res = await fetchFn("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch }),
  })
  if (!res.ok) throw new Error(await errorMessageFor(res))
  const { settings } = (await res.json()) as { settings: RedactedSettings }
  return settings
}
