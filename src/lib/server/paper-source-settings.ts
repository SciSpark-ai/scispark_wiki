import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import { withSettingsWrite } from "../vault/settings-write"
import { searchS2 } from "../papers/s2"
import { PaperSourceError } from "../papers/types"
import { enabledSourcesSchema, readEnabledPaperSources } from "../papers/source-preferences"
import type { PaperSourceStatus, SourceConnectionResult } from "../papers/source-settings-types"
import { getServerVault } from "./vault"

const SETTINGS_PATH = ".scispark/settings.json"
// Printable header-safe ASCII only. Never return Zod issues containing input.
const apiKeySchema = z.string().trim().min(1).max(2048).regex(/^[!-~]+$/)
export const sourceKeyPatchSchema = z.object({ apiKey: apiKeySchema.nullable() }).strict()
export const paperSourcePatchSchema = z.object({
  apiKey: apiKeySchema.nullable().optional(),
  enabledSources: enabledSourcesSchema.optional(),
}).strict().refine((patch) => patch.apiKey !== undefined || patch.enabledSources !== undefined)
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

async function credentials(storage: VaultStorage): Promise<{ apiKey?: string; status: PaperSourceStatus }> {
  const raw = await storage.read(SETTINGS_PATH)
  // Corrupt settings are an error, not permission to silently use anonymous mode.
  let file: unknown
  try { file = raw === null ? {} : JSON.parse(raw) }
  catch { throw new Error("Invalid settings file") } // JSON parse errors can quote a secret fragment.
  if (file === null || typeof file !== "object" || Array.isArray(file)) throw new Error("Invalid settings file")
  const savedValue = object(object(object(file).paperSources).s2).apiKey
  const saved = apiKeySchema.safeParse(savedValue)
  if (savedValue !== undefined && !saved.success) throw new Error("Invalid stored source key")
  const environment = apiKeySchema.safeParse(process.env.S2_API_KEY)
  const apiKey = saved.success ? saved.data : environment.success ? environment.data : undefined
  return {
    apiKey,
    status: {
      mode: apiKey ? "authenticated" : "anonymous",
      keySource: saved.success ? "vault" : environment.success ? "environment" : null,
      savedKeyPresent: saved.success,
    },
  }
}

/** Resolve on each call so save/replace/remove takes effect without a restart. */
export async function getServerS2Key(): Promise<string | undefined> {
  return (await credentials(await getServerVault())).apiKey
}

export async function getPaperSourceStatus(): Promise<PaperSourceStatus> {
  return (await credentials(await getServerVault())).status
}

export async function getPaperSourceSettings() {
  const storage = await getServerVault()
  return { s2: (await credentials(storage)).status, enabledSources: await readEnabledPaperSources(storage) }
}

export async function saveS2Key(storage: VaultStorage, key: string | null): Promise<void> {
  const parsed = sourceKeyPatchSchema.parse({ apiKey: key })
  await savePaperSourceSettings(storage, parsed)
}

export async function savePaperSourceSettings(storage: VaultStorage, patch: z.infer<typeof paperSourcePatchSchema>): Promise<void> {
  const parsed = paperSourcePatchSchema.parse(patch)
  await credentials(storage) // Refuse to overwrite malformed JSON.
  // Credentials deliberately never enter changesets, History, or exports.
  await withSettingsWrite(storage, (file) => {
    const paperSources = object(file.paperSources)
    const s2 = { ...object(paperSources.s2) }
    if (parsed.apiKey === null) delete s2.apiKey
    else if (parsed.apiKey !== undefined) s2.apiKey = parsed.apiKey
    return { ...file, paperSources: { ...paperSources, s2,
      ...(parsed.enabledSources ? { enabledSources: parsed.enabledSources } : {}),
    } }
  })
}

/** A user-triggered, fixed public query. No AI, user research, custom URL, or
 * browser-supplied credential in the probe. Default transport shares S2 pacing. */
export async function testS2Connection(deps: { fetchFn?: typeof fetch; signal?: AbortSignal } = {}): Promise<SourceConnectionResult> {
  const apiKey = await getServerS2Key()
  if (!apiKey) return { outcome: "missing_key", message: "Save a Semantic Scholar API key before testing the connection." }
  try {
    await searchS2({ query: "machine learning", limit: 1 }, { ...deps, apiKey })
    return { outcome: "ok", message: "Connection verified. Semantic Scholar accepted a search using your API key." }
  } catch (error) {
    if (error instanceof PaperSourceError && error.status === 429) return {
      outcome: "rate_limited", message: "Semantic Scholar rate-limited this test. Your key is still saved; wait before trying again. This does not tell us whether the key is valid.",
    }
    if (error instanceof PaperSourceError && (error.status === 401 || error.status === 403)) return {
      outcome: "rejected", message: "Semantic Scholar denied access. Check that this is a Semantic Scholar key and that API access is enabled.",
    }
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return {
      outcome: "timeout", message: "The connection test timed out or was cancelled. Your key is still saved; try again later.",
    }
    return { outcome: "unavailable", message: "Semantic Scholar could not be reached or returned an unexpected response. Your key is still saved; try again later." }
  }
}
