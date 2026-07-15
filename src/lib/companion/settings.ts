import type { VaultStorage } from "../vault/storage"
import { withSettingsWrite } from "../vault/settings-write"
import { COMPANION } from "./persona"

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
  /** User-chosen companion name (M7 addendum). Falls back to COMPANION.name
   * (the default "Ember") when absent, blank, or over MAX_NAME_LENGTH. */
  companionName: string
}

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  chattiness: "medium",
  companionName: COMPANION.name,
}

/** Max accepted companionName length; longer values fall back to the default. */
const MAX_NAME_LENGTH = 40

const CHATTINESS_VALUES: readonly Chattiness[] = ["off", "low", "medium", "high"]

function isChattiness(v: unknown): v is Chattiness {
  return typeof v === "string" && (CHATTINESS_VALUES as readonly string[]).includes(v)
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

/**
 * Cleans a user-supplied companion name for safe interpolation into a system
 * prompt: drops C0 control chars + DEL and collapses whitespace to a single
 * space so the name stays one line and can't start a fresh instruction line.
 * (Self-set in a single-user vault — hygiene, not a security boundary.)
 */
function sanitizeName(v: unknown): string {
  if (typeof v !== "string") return ""
  let out = ""
  for (const ch of v) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? " " : ch
  }
  return out.replace(/\s+/g, " ").trim()
}

export async function loadCompanionSettings(storage: VaultStorage): Promise<CompanionSettings> {
  const file = await readJsonFile(storage)
  const companion =
    file.companion !== null && typeof file.companion === "object"
      ? (file.companion as Record<string, unknown>)
      : {}

  // Validate the stored value against the union rather than trusting the file:
  // an unknown chattiness (stale schema, typo, hand-edit) must fall back to the
  // default, or SESSION_BUDGET[chattiness] would be undefined and silently mute
  // the companion forever.
  // The name is interpolated into a conversational skill's system prompt
  // (`You are ${name}, …`), so strip newlines/control chars to keep it a single
  // clean line — a name can't start a fresh instruction line. (Self-set in a
  // single-user vault, so this is hygiene, not a security boundary.)
  const rawName = sanitizeName(companion.companionName)
  const companionName =
    rawName.length > 0 && rawName.length <= MAX_NAME_LENGTH ? rawName : DEFAULT_COMPANION_SETTINGS.companionName

  return {
    chattiness: isChattiness(companion.chattiness)
      ? companion.chattiness
      : DEFAULT_COMPANION_SETTINGS.chattiness,
    companionName,
  }
}

export async function saveCompanionSettings(storage: VaultStorage, settings: CompanionSettings): Promise<void> {
  await withSettingsWrite(storage, (file) => ({ ...file, companion: settings }))
}
