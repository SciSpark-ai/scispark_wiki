import type { VaultStorage } from "../vault/storage"
import type { SciSparkEvent, LoggedEvent } from "./types"

export const EVENTS_DIR = ".scispark/events"

function monthFilePath(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `${EVENTS_DIR}/${year}-${month}.jsonl`
}

function isLoggedEvent(value: unknown): value is LoggedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { ts?: unknown }).ts === "string"
  )
}

// Serializes .scispark/events/*.jsonl read-modify-write cycles across every logEvent()
// call sharing a VaultStorage instance, mirroring the write-queue pattern in
// src/lib/llm/metering.ts. Keyed by storage instance identity — one queue per
// browser tab/process. Cross-tab/cross-process concurrency is out of scope until
// the sync backend (v2).
const eventWriteQueues = new WeakMap<VaultStorage, Promise<void>>()

/**
 * Appends one event to the current UTC month's JSONL file under `.scispark/events/`.
 * Never throws to the caller: storage failures are caught, logged via console.warn,
 * and swallowed, so event logging can never break a user-facing flow.
 */
export async function logEvent(
  storage: VaultStorage,
  event: SciSparkEvent,
  now: () => Date = () => new Date(),
): Promise<void> {
  const nowDate = now()
  const logged: LoggedEvent = { ...event, ts: nowDate.toISOString() }
  const path = monthFilePath(nowDate)

  const previous = eventWriteQueues.get(storage) ?? Promise.resolve()
  const work = async (): Promise<void> => {
    try {
      const existing = await storage.read(path)
      const next = (existing ?? "") + JSON.stringify(logged) + "\n"
      await storage.write(path, next)
    } catch (err) {
      console.warn("[events] logEvent failed to persist event", err)
    }
  }
  const thatLink = previous.then(work)
  // The queue link itself never rejects (work() already catches everything), but
  // guard anyway so one bad link can never wedge later logEvent calls on this storage.
  const queueTail = thatLink.then(
    () => undefined,
    () => undefined,
  )
  eventWriteQueues.set(storage, queueTail)
  await thatLink
}

async function readMonthEvents(storage: VaultStorage, path: string): Promise<LoggedEvent[]> {
  const raw = await storage.read(path)
  if (raw == null) return []
  const events: LoggedEvent[] = []
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const parsed = JSON.parse(line)
      if (isLoggedEvent(parsed)) events.push(parsed)
    } catch {
      // Skip corrupt lines.
      continue
    }
  }
  return events
}

async function monthFilesDescending(storage: VaultStorage): Promise<string[]> {
  const files = await storage.list(`${EVENTS_DIR}/`)
  return files.filter((p) => p.endsWith(".jsonl")).sort().reverse()
}

/**
 * Reads recent events across `.scispark/events/*.jsonl`, newest files first, until
 * `limit` events have been collected or files are exhausted. Returns them ascending
 * by `ts`, optionally filtered to events strictly after `sinceTs`.
 */
export async function readRecentEvents(
  storage: VaultStorage,
  opts: { limit?: number; sinceTs?: string } = {},
): Promise<LoggedEvent[]> {
  const limit = opts.limit ?? 200
  const files = await monthFilesDescending(storage)

  const collected: LoggedEvent[] = []
  for (const file of files) {
    if (collected.length >= limit) break
    collected.push(...(await readMonthEvents(storage, file)))
  }

  // `collected` is ordered newest-month-first with ascending order within each
  // month; sort once to get a single global ascending order.
  collected.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))

  let result = collected
  if (opts.sinceTs != null) {
    const sinceTs = opts.sinceTs
    result = result.filter((e) => e.ts > sinceTs)
  }

  // Reading whole files can pull in more than `limit` events; keep the most recent.
  if (result.length > limit) {
    result = result.slice(result.length - limit)
  }

  return result
}

/**
 * Counts events with `ts` strictly after `sinceTs` (or all events, when `sinceTs`
 * is null) across every month file. Since appends are chronological, once a file's
 * newest event is at or before `sinceTs`, older files can't contain anything newer
 * and reading stops there.
 */
export async function countEventsSince(storage: VaultStorage, sinceTs: string | null): Promise<number> {
  const files = await monthFilesDescending(storage)

  let count = 0
  for (const file of files) {
    const events = await readMonthEvents(storage, file)
    if (events.length === 0) continue

    const newestInFile = events[events.length - 1].ts
    if (sinceTs != null && newestInFile <= sinceTs) break

    count += sinceTs == null ? events.length : events.filter((e) => e.ts > sinceTs).length
  }

  return count
}
