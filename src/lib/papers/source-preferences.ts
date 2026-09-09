import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import { PAPER_SOURCE_IDS } from "./source-settings-types"

export const enabledSourcesSchema = z.array(z.enum(PAPER_SOURCE_IDS)).min(1).max(4)
  .refine((sources) => new Set(sources).size === sources.length)

/** Missing preferences preserve existing behavior. Invalid data must never
 * silently broaden retrieval to every source or echo settings/secret content. */
export function enabledSourcesFromSettings(file: Record<string, unknown>) {
  const sources = file.paperSources
  if (sources === undefined) return [...PAPER_SOURCE_IDS]
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) throw new Error("Invalid paper source settings")
  const value = (sources as Record<string, unknown>).enabledSources
  if (value === undefined) return [...PAPER_SOURCE_IDS]
  const parsed = enabledSourcesSchema.safeParse(value)
  if (!parsed.success) throw new Error("Invalid paper source selection. Check Paper sources in Settings.")
  return parsed.data
}

export async function readEnabledPaperSources(storage: VaultStorage) {
  const raw = await storage.read(".scispark/settings.json")
  let file: unknown
  try { file = raw === null ? {} : JSON.parse(raw) }
  catch { throw new Error("Invalid paper source settings") }
  if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error("Invalid paper source settings")
  return enabledSourcesFromSettings(file as Record<string, unknown>)
}
