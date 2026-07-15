import { getServerVault } from "@/lib/server/vault"
import { loadSettings, DEFAULT_SETTINGS, type LLMSettings } from "@/lib/llm/settings"
import { withSettingsWrite } from "@/lib/vault/settings-write"
import type { ProviderId } from "@/lib/llm/types"

/**
 * LLM settings/keys are server-only (M11 Task 4): the browser never receives
 * raw key material. GET returns a redacted view (`{present: true}` per
 * configured provider instead of the key string); PUT accepts a *patch* —
 * a value replaces the stored key, `""` deletes it, an omitted provider is
 * left untouched (the browser never needs to resend a key it never saw).
 */

export type RedactedKeys = Partial<Record<ProviderId, { present: true }>>

export interface RedactedSettings {
  keys: RedactedKeys
  tierModels: LLMSettings["tierModels"]
  dailyBudgetUsd: number
  baseUrls?: LLMSettings["baseUrls"]
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function redact(settings: LLMSettings): RedactedSettings {
  const keys: RedactedKeys = {}
  for (const [provider, key] of Object.entries(settings.keys)) {
    if (key) keys[provider as ProviderId] = { present: true }
  }
  return {
    keys,
    tierModels: settings.tierModels,
    dailyBudgetUsd: settings.dailyBudgetUsd,
    ...(settings.baseUrls ? { baseUrls: settings.baseUrls } : {}),
  }
}

/** Merges a patch of string values into a current record, where `""` deletes
 * the entry and an omitted key leaves the current entry untouched. */
function mergeDeletable<K extends string>(
  current: Partial<Record<K, string>>,
  patch: Partial<Record<K, string>>,
): Partial<Record<K, string>> {
  const next = { ...current }
  for (const [k, value] of Object.entries(patch) as [K, string | undefined][]) {
    if (value === "") delete next[k]
    else if (typeof value === "string") next[k] = value
  }
  return next
}

export async function GET(): Promise<Response> {
  try {
    const storage = await getServerVault()
    const settings = await loadSettings(storage)
    return jsonResponse(200, { settings: redact(settings) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse(500, { error: message })
  }
}

export async function PUT(req: Request): Promise<Response> {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" })
  }

  if (payload === null || typeof payload !== "object" || !("patch" in payload)) {
    return jsonResponse(400, { error: "patch is required" })
  }
  const patch = (payload as { patch: unknown }).patch
  if (patch === null || typeof patch !== "object") {
    return jsonResponse(400, { error: "patch must be an object" })
  }
  const p = patch as Partial<LLMSettings>

  try {
    const storage = await getServerVault()

    // The read (current llm settings), the patch merge, and the write must
    // happen inside a single withSettingsWrite critical section — reading via
    // loadSettings() first and saving separately (M11) left a gap where a
    // concurrent companion/trending save (or another /api/settings PUT) could
    // interleave between this route's read and write, losing an update.
    let next: LLMSettings = DEFAULT_SETTINGS
    await withSettingsWrite(storage, (file) => {
      const llmRaw = (file.llm !== null && typeof file.llm === "object" ? file.llm : {}) as Partial<LLMSettings>
      const current: LLMSettings = {
        keys: { ...DEFAULT_SETTINGS.keys, ...(llmRaw.keys ?? {}) },
        tierModels: {
          fast: { ...DEFAULT_SETTINGS.tierModels.fast, ...(llmRaw.tierModels?.fast ?? {}) },
          strong: { ...DEFAULT_SETTINGS.tierModels.strong, ...(llmRaw.tierModels?.strong ?? {}) },
        },
        dailyBudgetUsd: llmRaw.dailyBudgetUsd ?? DEFAULT_SETTINGS.dailyBudgetUsd,
        ...(llmRaw.baseUrls ? { baseUrls: { ...llmRaw.baseUrls } } : {}),
      }

      const merged: LLMSettings = {
        keys: p.keys ? mergeDeletable(current.keys, p.keys) : current.keys,
        tierModels: {
          fast: { ...current.tierModels.fast, ...(p.tierModels?.fast ?? {}) },
          strong: { ...current.tierModels.strong, ...(p.tierModels?.strong ?? {}) },
        },
        dailyBudgetUsd: p.dailyBudgetUsd ?? current.dailyBudgetUsd,
      }

      const mergedBaseUrls = p.baseUrls
        ? mergeDeletable(current.baseUrls ?? {}, p.baseUrls)
        : current.baseUrls
      if (mergedBaseUrls && Object.keys(mergedBaseUrls).length > 0) {
        merged.baseUrls = mergedBaseUrls
      }

      next = merged
      return { ...file, llm: merged }
    })

    return jsonResponse(200, { settings: redact(next) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse(500, { error: message })
  }
}
