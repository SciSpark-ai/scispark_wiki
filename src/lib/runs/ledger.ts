import type { VaultStorage } from "../vault/storage"

export const LEDGER_PATH = ".scispark/runs/ledger.jsonl"

/** The set of skill orchestrators whose runs are tracked in the ledger. */
export type OrchestratorName =
  | "feed-refresh"
  | "trending-refresh"
  | "consolidation"
  | "ingest"
  | "lint-deterministic"
  | "lint-llm"
  | "spark-deep"
  | "enrich"

/** How a run was initiated. */
export type RunTrigger = "user" | "schedule"

/** One durable outcome record for a single orchestrator run. */
export interface OrchestratorRunRecord {
  ts: string
  orchestrator: OrchestratorName
  trigger: RunTrigger
  status: "ok" | "degraded" | "failed" | "skipped"
  reason?: string
  costUsd?: number
  meta?: Record<string, unknown>
}

function isOrchestratorRunRecord(value: unknown): value is OrchestratorRunRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { ts?: unknown }).ts === "string" &&
    typeof (value as { orchestrator?: unknown }).orchestrator === "string" &&
    typeof (value as { trigger?: unknown }).trigger === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  )
}

// Serializes .scispark/runs/ledger.jsonl read-modify-write cycles across every
// recordOrchestratorRun() call sharing a VaultStorage instance, mirroring the
// write-queue pattern in src/lib/events/log.ts. Keyed by storage instance identity —
// one queue per browser tab/process. Cross-tab/cross-process concurrency is out of
// scope until the sync backend (v2).
const ledgerWriteQueues = new WeakMap<VaultStorage, Promise<void>>()

/**
 * Appends one orchestrator-run outcome record to `.scispark/runs/ledger.jsonl`.
 * Never throws to the caller: storage failures are caught, logged via console.warn,
 * and swallowed, so ledger recording can never break a user-facing orchestrator run.
 */
export async function recordOrchestratorRun(
  storage: VaultStorage,
  rec: Omit<OrchestratorRunRecord, "ts">,
  now: () => Date = () => new Date(),
): Promise<void> {
  const record: OrchestratorRunRecord = { ...rec, ts: now().toISOString() }

  const previous = ledgerWriteQueues.get(storage) ?? Promise.resolve()
  const work = async (): Promise<void> => {
    try {
      const existing = await storage.read(LEDGER_PATH)
      const next = (existing ?? "") + JSON.stringify(record) + "\n"
      await storage.write(LEDGER_PATH, next)
    } catch (err) {
      console.warn("[runs] recordOrchestratorRun failed to persist record", err)
    }
  }
  const thatLink = previous.then(work)
  // The queue link itself never rejects (work() already catches everything), but
  // guard anyway so one bad link can never wedge later recordOrchestratorRun calls
  // on this storage.
  const queueTail = thatLink.then(
    () => undefined,
    () => undefined,
  )
  ledgerWriteQueues.set(storage, queueTail)
  await thatLink
}

/**
 * Reads orchestrator-run records from `.scispark/runs/ledger.jsonl`, newest first.
 * Tolerant of corrupt/unparseable lines (skipped rather than thrown). Defaults to
 * the 50 most recent records.
 */
export async function readLedger(
  storage: VaultStorage,
  opts: { limit?: number } = {},
): Promise<OrchestratorRunRecord[]> {
  const limit = opts.limit ?? 50
  const raw = await storage.read(LEDGER_PATH)
  if (raw == null) return []

  const records: OrchestratorRunRecord[] = []
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue
    try {
      const parsed = JSON.parse(line)
      if (isOrchestratorRunRecord(parsed)) records.push(parsed)
    } catch {
      // Skip corrupt lines.
      continue
    }
  }

  return records.slice(-limit).reverse()
}

/**
 * Wraps a skill-orchestrator call so every run leaves a durable ledger record.
 * Runs `fn`, records the status/cost/meta it returns, and returns its result. If
 * `fn` throws, records a `"failed"` outcome with the error's message (or the thrown
 * value's string form, if it isn't an `Error`) and rethrows unchanged.
 */
export async function withLedger<T>(
  storage: VaultStorage,
  opts: { orchestrator: OrchestratorName; trigger: RunTrigger; now?: () => Date },
  fn: () => Promise<{
    result: T
    status: OrchestratorRunRecord["status"]
    reason?: string
    costUsd?: number
    meta?: Record<string, unknown>
  }>,
): Promise<T> {
  const { orchestrator, trigger, now } = opts
  try {
    const { result, status, reason, costUsd, meta } = await fn()
    await recordOrchestratorRun(storage, { orchestrator, trigger, status, reason, costUsd, meta }, now)
    return result
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await recordOrchestratorRun(storage, { orchestrator, trigger, status: "failed", reason }, now)
    throw err
  }
}
