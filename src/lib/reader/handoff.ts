import type { VaultStorage } from "../vault/storage"
import { paperKey, type PaperRecord } from "../papers/types"
import { paperSlug } from "../wiki/authoring"
import { sanitizeSlug } from "../wiki/acquire"

/**
 * A transient "open this elsewhere" handoff. When the user opens a paper
 * that isn't in the feed cache and isn't yet an ingested wiki page — e.g. one
 * they just found via the /papers search box — the calling page has the full
 * `PaperRecord` (with `htmlUrl`/`oaUrl`/`pdfUrl` and abstract) in hand, but a
 * fresh navigation to `/reader?paperKey=` or `/paper/<slug>` does not. We
 * stash the record in the vault so the destination page can resolve it after
 * the client-side navigation, on a reload, or from a deep link.
 *
 * Addressable by BOTH identifiers: `writeReaderHandoff` writes the record
 * under its `paperKey` path AND its `paperSlug` path (two small files, same
 * content) so a single write is resolvable by whichever downstream lookup
 * applies — `readReaderHandoff` (the reader's `?paperKey=` resolution, via
 * `resolvePaperByKey`) or `readReaderHandoffBySlug` (`/paper/<slug>`'s
 * resolution, via `resolvePaperBySlug`) — without the writer needing to know
 * which one a caller will use.
 *
 * App-owned data under `.scispark/`, direct writes (same rationale as the digest
 * cache / event log — not a wiki page, not a changeset).
 */
export const READER_HANDOFF_DIR = ".scispark/reader"

export function readerHandoffPath(id: string): string {
  return `${READER_HANDOFF_DIR}/${sanitizeSlug(id)}.json`
}

export async function writeReaderHandoff(storage: VaultStorage, paper: PaperRecord): Promise<void> {
  const json = JSON.stringify(paper)
  await Promise.all([
    storage.write(readerHandoffPath(paperKey(paper)), json),
    storage.write(readerHandoffPath(paperSlug(paper)), json),
  ])
}

async function readHandoff(
  storage: VaultStorage,
  id: string,
  matches: (parsed: PaperRecord) => boolean,
): Promise<PaperRecord | null> {
  const raw = await storage.read(readerHandoffPath(id))
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as PaperRecord
    // Guard against a stale/mismatched file: only honor it if its own
    // identifier (whichever form the caller is looking up by) still matches.
    if (parsed && typeof parsed.title === "string" && matches(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

/** Returns the stashed record for `key` (paperKey form), or null when absent/corrupt/stale. */
export async function readReaderHandoff(storage: VaultStorage, key: string): Promise<PaperRecord | null> {
  return readHandoff(storage, key, (parsed) => paperKey(parsed) === key)
}

/** Returns the stashed record for `slug` (paperSlug form), or null when absent/corrupt/stale. */
export async function readReaderHandoffBySlug(storage: VaultStorage, slug: string): Promise<PaperRecord | null> {
  return readHandoff(storage, slug, (parsed) => paperSlug(parsed) === slug)
}
