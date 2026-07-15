import { getServerVault } from "@/lib/server/vault"
import { loadSettings, DEFAULT_SETTINGS, type LLMSettings } from "@/lib/llm/settings"
import {
  loadCompanionSettings,
  normalizeCompanionSettings,
  type CompanionSettings,
} from "@/lib/companion/settings"
import {
  loadTrendingSettings,
  normalizeTrendingSettings,
  type TrendingSettings,
} from "@/lib/trending/settings"
import { withSettingsWrite } from "@/lib/vault/settings-write"
import type { ProviderId } from "@/lib/llm/types"

/**
 * `.scispark/settings.json` is server-only (M11 Task 4): the generic
 * `/api/vault/file` route 403s that path, so this route is the ONE surface a
 * browser has for every settings sub-object living in that file.
 *
 * - `llm` keys are secret — GET returns a redacted view (`{present: true}` per
 *   configured provider instead of the key string); PUT accepts a *patch* —
 *   a value replaces the stored key, `""` deletes it, an omitted provider is
 *   left untouched (the browser never needs to resend a key it never saw).
 * - `companion` (name + chattiness) and `trending` (tracked fields + cadence)
 *   are NOT secret — GET returns them in full and PUT replaces the whole
 *   sub-object (matching `saveCompanionSettings`/`saveTrendingSettings`
 *   semantics). They ride on this route because the vault-file route can't
 *   reach the file (M12 follow-up: the 403 lockdown had orphaned every non-LLM
 *   settings surface that used to read/write settings.json via the browser's
 *   RemoteVaultStorage).
 */

export type RedactedKeys = Partial<Record<ProviderId, { present: true }>>

export interface RedactedSettings {
  keys: RedactedKeys
  tierModels: LLMSettings["tierModels"]
  dailyBudgetUsd: number
  baseUrls?: LLMSettings["baseUrls"]
}

/** Shared shape returned by both GET and PUT: the redacted LLM view plus the
 * (non-secret) companion and trending sub-objects in full. */
export interface SettingsResponse {
  settings: RedactedSettings
  companion: CompanionSettings
  trending: TrendingSettings
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
    const [settings, companion, trending] = await Promise.all([
      loadSettings(storage),
      loadCompanionSettings(storage),
      loadTrendingSettings(storage),
    ])
    const body: SettingsResponse = { settings: redact(settings), companion, trending }
    return jsonResponse(200, body)
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

  if (payload === null || typeof payload !== "object") {
    return jsonResponse(400, { error: "body must be an object" })
  }
  const body = payload as { patch?: unknown; companion?: unknown; trending?: unknown }

  const hasPatch = "patch" in body
  const hasCompanion = "companion" in body
  const hasTrending = "trending" in body
  // A PUT must touch at least one sub-object. `patch` is the LLM partial
  // (kept for back-compat with the debug page's combined save); `companion`
  // and `trending` are full-object replacements.
  if (!hasPatch && !hasCompanion && !hasTrending) {
    return jsonResponse(400, { error: "at least one of patch, companion, trending is required" })
  }

  let p: Partial<LLMSettings> = {}
  if (hasPatch) {
    if (body.patch === null || typeof body.patch !== "object") {
      return jsonResponse(400, { error: "patch must be an object" })
    }
    p = body.patch as Partial<LLMSettings>
  }
  if (hasCompanion && (body.companion === null || typeof body.companion !== "object")) {
    return jsonResponse(400, { error: "companion must be an object" })
  }
  if (hasTrending && (body.trending === null || typeof body.trending !== "object")) {
    return jsonResponse(400, { error: "trending must be an object" })
  }

  try {
    const storage = await getServerVault()

    // Read, merge, and write for ALL sub-objects happen inside a single
    // withSettingsWrite critical section — reading first and saving separately
    // (M11) left a gap where a concurrent settings save could interleave
    // between this route's read and write, losing an update. Each sub-object is
    // touched only when present in the body, so an llm-only save leaves
    // companion/trending verbatim (and vice versa).
    let nextLlm: LLMSettings = DEFAULT_SETTINGS
    let nextCompanion: CompanionSettings = normalizeCompanionSettings(undefined)
    let nextTrending: TrendingSettings = normalizeTrendingSettings(undefined)
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

      // Response reflects the resulting full state: a patched sub-object's new
      // value, or the (validated) existing value when this PUT didn't touch it.
      nextLlm = hasPatch ? merged : current
      nextCompanion = hasCompanion
        ? normalizeCompanionSettings(body.companion)
        : normalizeCompanionSettings(file.companion)
      nextTrending = hasTrending
        ? normalizeTrendingSettings(body.trending)
        : normalizeTrendingSettings(file.trending)

      const out = { ...file }
      if (hasPatch) out.llm = merged
      if (hasCompanion) out.companion = nextCompanion
      if (hasTrending) out.trending = nextTrending
      return out
    })

    const res: SettingsResponse = {
      settings: redact(nextLlm),
      companion: nextCompanion,
      trending: nextTrending,
    }
    return jsonResponse(200, res)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse(500, { error: message })
  }
}
