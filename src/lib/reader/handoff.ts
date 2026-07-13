import type { VaultStorage } from "../vault/storage"
import { paperKey, type PaperRecord } from "../papers/types"
import { sanitizeSlug } from "../wiki/acquire"

/**
 * A transient "open this in the reader" handoff. When the user clicks
 * "Read full paper" on a paper that isn't in the feed cache and isn't yet an
 * ingested wiki page — e.g. a paper they just found via the /papers search box —
 * the calling page has the full `PaperRecord` (with `htmlUrl`/`oaUrl`/`pdfUrl`
 * and abstract) in hand, but a fresh `/reader?paperKey=` navigation does not.
 * We stash the record in the vault so the reader can resolve it after the
 * client-side navigation, on a reload, or from a deep link.
 *
 * App-owned data under `.scispark/`, direct writes (same rationale as the digest
 * cache / event log — not a wiki page, not a changeset).
 */
export const READER_HANDOFF_DIR = ".scispark/reader"

export function readerHandoffPath(key: string): string {
  return `${READER_HANDOFF_DIR}/${sanitizeSlug(key)}.json`
}

export async function writeReaderHandoff(storage: VaultStorage, paper: PaperRecord): Promise<void> {
  await storage.write(readerHandoffPath(paperKey(paper)), JSON.stringify(paper))
}

/** Returns the stashed record for `key`, or null when absent/corrupt. */
export async function readReaderHandoff(storage: VaultStorage, key: string): Promise<PaperRecord | null> {
  const raw = await storage.read(readerHandoffPath(key))
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as PaperRecord
    // Guard against a stale/mismatched file: only honor it if its own key matches.
    if (parsed && typeof parsed.title === "string" && paperKey(parsed) === key) return parsed
    return null
  } catch {
    return null
  }
}
