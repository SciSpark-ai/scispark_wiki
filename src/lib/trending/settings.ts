import type { VaultStorage } from "../vault/storage"
import { withSettingsWrite } from "../vault/settings-write"
import type { TrackedField } from "./fields"
import { MAX_TRACKED_FIELDS } from "./fields"

/**
 * Trending settings — stored under a top-level "trending" key in
 * `.scispark/settings.json`, a sibling of the "llm"/"companion" keys. Mirrors
 * src/lib/companion/settings.ts: reading tolerates a missing file/section,
 * saving never clobbers sibling keys, and writes are serialized per storage.
 */

const SETTINGS_PATH = ".scispark/settings.json"

export type Cadence = "daily" | "weekly"

export interface TrendingSettings {
  fields: TrackedField[]
  cadence: Cadence
}

export const DEFAULT_TRENDING_SETTINGS: TrendingSettings = { fields: [], cadence: "weekly" }

const CADENCE_VALUES: readonly Cadence[] = ["daily", "weekly"]

function isCadence(v: unknown): v is Cadence {
  return typeof v === "string" && (CADENCE_VALUES as readonly string[]).includes(v)
}

function isTrackedField(v: unknown): v is TrackedField {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as TrackedField).slug === "string" &&
    typeof (v as TrackedField).label === "string" &&
    (v as TrackedField).slug.length > 0 &&
    (v as TrackedField).label.length > 0
  )
}

/**
 * Dedupes fields by slug, keeping the first occurrence. Two labels that
 * slugify identically (e.g. "NLP" and "nlp") would otherwise both persist,
 * doubling strong-tier LLM spend per refresh and producing duplicate React
 * keys in the dashboard. Applied centrally (save + load) so no caller —
 * present or future — can reintroduce the bug.
 */
function dedupeFieldsBySlug(fields: TrackedField[]): TrackedField[] {
  const seen = new Set<string>()
  const out: TrackedField[] = []
  for (const f of fields) {
    if (seen.has(f.slug)) continue
    seen.add(f.slug)
    out.push(f)
  }
  return out
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

/**
 * Validates a raw `trending` section (from the settings file or an API
 * payload) into a full TrendingSettings, falling back to defaults for any
 * missing/invalid field. Pure — no storage — so it's shared by the
 * storage-backed loader below and the `/api/settings` route (which validates
 * client-supplied trending patches with the exact same rules, including the
 * dedupe-by-slug guard).
 */
export function normalizeTrendingSettings(raw: unknown): TrendingSettings {
  const t = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const fields = Array.isArray(t.fields)
    ? dedupeFieldsBySlug(t.fields.filter(isTrackedField) as TrackedField[]).slice(0, MAX_TRACKED_FIELDS)
    : DEFAULT_TRENDING_SETTINGS.fields
  return {
    fields,
    cadence: isCadence(t.cadence) ? t.cadence : DEFAULT_TRENDING_SETTINGS.cadence,
  }
}

export async function loadTrendingSettings(storage: VaultStorage): Promise<TrendingSettings> {
  const file = await readJsonFile(storage)
  return normalizeTrendingSettings(file.trending)
}

export async function saveTrendingSettings(storage: VaultStorage, settings: TrendingSettings): Promise<void> {
  await withSettingsWrite(storage, (file) => ({
    ...file,
    trending: { ...settings, fields: dedupeFieldsBySlug(settings.fields) },
  }))
}
