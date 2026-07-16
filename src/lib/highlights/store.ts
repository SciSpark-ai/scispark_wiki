import { sanitizeSlug } from "../wiki/acquire"
import type { VaultStorage } from "../vault/storage"
import type { Highlight } from "./types"

export const HIGHLIGHTS_DIR = "highlights"

/**
 * Path for a paper's highlights file. Uses the SAME slug that
 * src/lib/wiki/acquire.ts snapshotSource uses for sources/<slug>.html
 * (sanitizeSlug(paperKey(paper))), so the reader and the store agree on the
 * path. `paperKey` here is already the key string — callers pass
 * paperKey(paper), not the paper record.
 */
export function highlightsPath(paperKey: string): string {
  return `${HIGHLIGHTS_DIR}/${sanitizeSlug(paperKey)}.json`
}

// Module counter guarantees uniqueness across ids minted within the same
// millisecond (and across ids minted with the same injected `now`).
let highlightIdCounter = 0

/**
 * Mints a stable highlight id: h_<timestamp-from-now>_<counter>. `now` is
 * injectable (mirrors makeChangesetId's idiom minus the non-deterministic
 * Math.random, so tests can assert exact ids without stubbing globals).
 */
export function makeHighlightId(now: () => Date = () => new Date()): string {
  highlightIdCounter += 1
  return `h_${now().getTime()}_${highlightIdCounter}`
}

// Serializes read-modify-write cycles for a single paper's highlights file
// across every add/update/remove call sharing a VaultStorage instance,
// mirroring the write-queue pattern in src/lib/events/log.ts. Keyed by
// storage instance identity — one queue per browser tab/process.
const highlightWriteQueues = new WeakMap<VaultStorage, Promise<void>>()

function withWriteQueue(storage: VaultStorage, work: () => Promise<void>): Promise<void> {
  const previous = highlightWriteQueues.get(storage) ?? Promise.resolve()
  const thatLink = previous.then(work)
  // The queue link itself must never reject (a bad link would wedge every
  // later call on this storage), even though `work` above can throw.
  const queueTail = thatLink.then(
    () => undefined,
    () => undefined,
  )
  highlightWriteQueues.set(storage, queueTail)
  return thatLink
}

async function readHighlightsRaw(storage: VaultStorage, paperKey: string): Promise<Highlight[]> {
  const raw = await storage.read(highlightsPath(paperKey))
  if (raw == null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Highlight[]) : []
  } catch {
    return []
  }
}

/** Lists all highlights for a paper. Never throws: a missing or corrupt
 * highlights file resolves to []. */
export async function listHighlights(storage: VaultStorage, paperKey: string): Promise<Highlight[]> {
  return readHighlightsRaw(storage, paperKey)
}

/**
 * `listHighlights` with bounded retries for TRANSPORT failures. A missing or
 * corrupt file already resolves to [] without throwing (see listHighlights);
 * what CAN throw is the storage read itself — over `RemoteVaultStorage`
 * that's any non-404 HTTP failure (dev server mid-restart, transient network
 * error). Before this, the reader's mount-time load had no recovery path: a
 * single rejected fetch left the session with zero highlights, silently —
 * "saved on disk but never re-painted after reload."
 *
 * After `attempts` consecutive failures, logs the last error and resolves []
 * (the reader still works, just without painted highlights). `sleep` is
 * injectable so tests don't wait out real backoff delays.
 */
export async function listHighlightsWithRetry(
  storage: VaultStorage,
  paperKey: string,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Highlight[]> {
  const attempts = opts.attempts ?? 3
  const delayMs = opts.delayMs ?? 300
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await listHighlights(storage, paperKey)
    } catch (err) {
      lastError = err
      if (attempt < attempts) await sleep(delayMs * attempt)
    }
  }
  console.error(`listHighlightsWithRetry: all ${attempts} attempts failed for ${paperKey}`, lastError)
  return []
}

/** Appends one highlight, serialized against concurrent add/update/remove
 * calls on the same storage so writes never drop entries. */
export async function addHighlight(storage: VaultStorage, paperKey: string, h: Highlight): Promise<void> {
  return withWriteQueue(storage, async () => {
    const current = await readHighlightsRaw(storage, paperKey)
    current.push(h)
    await storage.write(highlightsPath(paperKey), JSON.stringify(current, null, 2))
  })
}

/** Patches an existing highlight's color and/or note. No-op when `id` isn't
 * found (never throws). */
export async function updateHighlight(
  storage: VaultStorage,
  paperKey: string,
  id: string,
  patch: Partial<Pick<Highlight, "color" | "note">>,
): Promise<void> {
  return withWriteQueue(storage, async () => {
    const current = await readHighlightsRaw(storage, paperKey)
    const idx = current.findIndex((h) => h.id === id)
    if (idx === -1) return
    current[idx] = { ...current[idx], ...patch }
    await storage.write(highlightsPath(paperKey), JSON.stringify(current, null, 2))
  })
}

/** Removes a highlight by id. No-op when `id` isn't found (never throws). */
export async function removeHighlight(storage: VaultStorage, paperKey: string, id: string): Promise<void> {
  return withWriteQueue(storage, async () => {
    const current = await readHighlightsRaw(storage, paperKey)
    const next = current.filter((h) => h.id !== id)
    if (next.length === current.length) return
    await storage.write(highlightsPath(paperKey), JSON.stringify(next, null, 2))
  })
}

/**
 * Formats highlights as one line each for ingest-emphasis prompt context
 * (feeds buildAnalysisContext({ highlights })): the exact quote, trimmed,
 * with " — <note>" appended when a note is present.
 */
export function formatHighlightsForPrompt(highlights: Highlight[]): string[] {
  return highlights.map((h) => {
    const exact = h.anchor.exact.trim()
    const note = h.note.trim()
    return note.length > 0 ? `${exact} — ${note}` : exact
  })
}
