import type { VaultStorage } from "../vault/storage"
import type { LLMSettings } from "./settings"
import type { LLMUsage, ProviderId } from "./types"
import { LLMError } from "./types"
import { estimateCostUsd } from "./pricing"

export interface UsageRecord {
  ts: string
  skill: string
  runId: string
  provider: ProviderId
  model: string
  usage: LLMUsage
  costUsd: number | null
}

function dayFilePath(date: string): string {
  return `.scispark/usage/${date}.jsonl`
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Serializes .scispark/usage/*.jsonl read-modify-write cycles across every Meter
// instance backed by the same VaultStorage — e.g. two concurrent runSkill() calls
// each construct their own Meter over one shared storage, and both must not race
// on the same day file. Keyed by storage instance identity, which in practice
// means one queue per browser tab/process (each tab/process holds one storage
// handle). Cross-tab/cross-process concurrency — separate storage instances
// writing the same underlying files — is out of scope until the sync backend (v2).
const usageWriteQueues = new WeakMap<VaultStorage, Promise<void>>()

export class Meter {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private storage: VaultStorage,
    private now: () => Date = () => new Date(),
  ) {}

  async record(r: Omit<UsageRecord, "ts" | "costUsd">, scopedCostUsd?: number | null): Promise<UsageRecord> {
    const nowDate = this.now()
    const rec: UsageRecord = {
      ...r,
      ts: nowDate.toISOString(),
      costUsd: scopedCostUsd === undefined ? estimateCostUsd(r.model, r.usage) : scopedCostUsd,
    }

    const path = dayFilePath(utcDateString(nowDate))

    // JSONL append = read existing file + append line + write back. Route every
    // read-modify-write through a promise-chain mutex (shared across Meter
    // instances on the same storage, via `usageWriteQueues`) so concurrent
    // record() calls append in order with zero lost records, instead of racing
    // to read the same pre-write bytes and clobbering each other's line on write.
    const previous = usageWriteQueues.get(this.storage) ?? this.writeQueue
    const work = async (): Promise<void> => {
      const existing = await this.storage.read(path)
      const next = (existing ?? "") + JSON.stringify(rec) + "\n"
      await this.storage.write(path, next)
    }
    const thatLink = previous.then(work)
    // Swallow failures in the shared queue link itself so one failed write
    // doesn't wedge every later record() call on this storage; the failure
    // still propagates to *this* call's caller via `await thatLink` below.
    const queueTail = thatLink.then(
      () => undefined,
      () => undefined,
    )
    this.writeQueue = queueTail
    usageWriteQueues.set(this.storage, queueTail)
    await thatLink

    return rec
  }

  async recordsForDay(date: string): Promise<UsageRecord[]> {
    const raw = await this.storage.read(dayFilePath(date))
    if (raw == null) return []
    const records: UsageRecord[] = []
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue
      try {
        const parsed = JSON.parse(line)
        // Skip non-object values (null, string, number, array, etc.)
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          records.push(parsed as UsageRecord)
        }
      } catch {
        // Skip unparseable lines (corrupted JSON)
        continue
      }
    }
    return records
  }

  async spendingToday(): Promise<{ totalUsd: number | null; knownUsd: number; unpricedCount: number }> {
    const records = await this.recordsForDay(utcDateString(this.now()))
    const knownUsd = records.reduce((sum, r) => sum + (typeof r.costUsd === "number" && Number.isFinite(r.costUsd) ? r.costUsd : 0), 0)
    const unpricedCount = records.filter((r) => typeof r.costUsd !== "number" || !Number.isFinite(r.costUsd)).length
    return { totalUsd: unpricedCount ? null : knownUsd, knownUsd, unpricedCount }
  }

  async spentTodayUsd(): Promise<number | null> {
    return (await this.spendingToday()).totalUsd
  }

  async reviewReservationsToday(): Promise<number> {
    const raw = await this.storage.read(".scispark/usage/review-attempts.json")
    if (raw === null) return 0
    const records = JSON.parse(raw) as Array<{ day: string; state: string; reservedUsd: number; metered?: boolean; costUsd?: number | null }>
    if (!Array.isArray(records)) throw new Error("Unreadable review billing record")
    return records.filter((r) => r.day === utcDateString(this.now()) && !r.metered)
      .reduce((sum, r) => {
        const cost = r.costUsd ?? r.reservedUsd
        if (!Number.isFinite(cost) || cost < 0) throw new Error("Invalid review reservation")
        return sum + cost
      }, 0)
  }
}

export class BudgetExceededError extends LLMError {
  constructor(
    public spentUsd: number,
    public budgetUsd: number,
  ) {
    super(
      `Daily budget exceeded: spent $${spentUsd.toFixed(4)} of a $${budgetUsd.toFixed(2)} daily budget`,
    )
  }
}

export async function checkBudget(
  meter: Meter,
  settings: LLMSettings,
  estimatedNextCallUsd?: number,
  onWarning?: (message: string) => void,
): Promise<void> {
  const spending = await meter.spendingToday()
  const spentUsd = spending.knownUsd
  if (spending.unpricedCount) onWarning?.("Budget coverage is incomplete: unpriced calls are recorded, but only known costs count toward the local limit. Check your provider’s spending limit.")
  const projected = spentUsd + await meter.reviewReservationsToday() + (estimatedNextCallUsd ?? 0)
  if (projected >= settings.dailyBudgetUsd) {
    throw new BudgetExceededError(spentUsd, settings.dailyBudgetUsd)
  }
}
