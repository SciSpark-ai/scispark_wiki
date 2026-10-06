import { classificationRecords } from "../extensions/classification-record"
import { readNativeReservations } from "./native-reservations"
import { UsageJournalSchema } from "../workflows/contracts"
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

    const path = dayFilePath(nowDate.toISOString().slice(0, 10))

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
    const records = (await this.recordsForDay(this.now().toISOString().slice(0, 10))).filter((r) => r.usage?.billingMode !== "subscription")
    const knownUsd = records.reduce((sum, r) => sum + (typeof r.costUsd === "number" && Number.isFinite(r.costUsd) ? r.costUsd : 0), 0)
    const unpricedCount = records.filter((r) => typeof r.costUsd !== "number" || !Number.isFinite(r.costUsd)).length
    return { totalUsd: unpricedCount ? null : knownUsd, knownUsd, unpricedCount }
  }

  async spentTodayUsd(): Promise<number | null> {
    return (await this.spendingToday()).totalUsd
  }

  /** Workflow holds share the daily cap with existing API and review work.
   * Native attempts are charged by their own ledger, never by this journal. */
  async workflowReservationsToday(): Promise<number> {
    const today = this.now().toISOString().slice(0, 10)
    let held = 0
    for (const path of await this.storage.list(".scispark/tool-runs/")) {
      if (!/^\.scispark\/tool-runs\/[a-f0-9-]+\/usage\.json$/.test(path)) continue
      const raw = await this.storage.read(path)
      if (raw === null) throw new Error("Workflow usage journal disappeared")
      const journal = UsageJournalSchema.parse(JSON.parse(raw))
      if (path !== `.scispark/tool-runs/${journal.runId}/usage.json`) throw new Error("Workflow usage identity mismatch")
      for (const row of journal.attempts) {
        if (row.ticket.estimate.accountingOwner !== "workflow" || row.ticket.estimate.costUsd === null) continue
        const day = row.ticket.reservedAt.slice(0, 10)
        if (row.state === "known" && day !== today) continue
        const billed = (await this.recordsForDay(day)).find((record) => record.runId === row.ticket.id)
        const charge = row.state === "known" ? row.result!.costUsd ?? row.ticket.estimate.costUsd
          : Math.max(row.ticket.estimate.costUsd, row.result?.costUsd ?? 0)
        // When settlement follows a successful Meter write, retain only any
        // still-uncertain remainder rather than double charging the same call.
        held += Math.max(0, charge - (typeof billed?.costUsd === "number" ? billed.costUsd : 0))
      }
    }
    return held
  }

  async nativeReservationsToday(): Promise<number> {
    let held = 0
    for (const row of await readNativeReservations(this.storage)) {
      if (row.billingMode === "subscription" || row.reservedUsd === null) continue
      if (row.state !== "reserved" && row.day !== this.now().toISOString().slice(0, 10)) continue
      const billed = (await this.recordsForDay(row.day)).find(record => record.runId === row.id)
      const amount = row.state !== "reserved" ? row.costUsd ?? row.reservedUsd : Math.max(row.reservedUsd, row.costUsd ?? 0)
      held += Math.max(0, amount - (typeof billed?.costUsd === "number" ? billed.costUsd : 0))
    }
    return held
  }

  async classificationReservationsToday(): Promise<number> {
    let held = 0
    for (const row of await classificationRecords(this.storage)) {
      if (row.reservedUsd === null || (row.state === "known" && row.day !== this.now().toISOString().slice(0, 10))) continue
      const billed = (await this.recordsForDay(row.day)).find(record => record.runId === row.id)
      // Classification has exactly one raw call. A matching persisted Meter
      // result is settlement proof even if its write response or decision was
      // lost. The decision remains unknown and is never dispatched again.
      const selected = row.model.tierModels.fast
      if (billed?.skill === "tool-intent" && billed.provider === selected.provider && billed.model === selected.model
        && billed.usage?.reported !== false && typeof billed.costUsd === "number" && Number.isFinite(billed.costUsd) && billed.costUsd >= 0) continue
      const amount = row.state === "known" ? row.costUsd ?? row.reservedUsd : Math.max(row.reservedUsd, row.costUsd ?? 0)
      held += Math.max(0, amount - (typeof billed?.costUsd === "number" ? billed.costUsd : 0))
    }
    return held
  }

  async reviewReservationsToday(): Promise<number> {
    const raw = await this.storage.read(".scispark/usage/review-attempts.json")
    if (raw === null) return 0
    const records = JSON.parse(raw) as Array<{ day: string; state: string; reservedUsd: number; metered?: boolean; costUsd?: number | null }>
    if (!Array.isArray(records)) throw new Error("Unreadable review billing record")
    return records.filter((r) => r.day === this.now().toISOString().slice(0, 10) && !r.metered)
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
  const projected = spentUsd + await meter.reviewReservationsToday() + await meter.workflowReservationsToday() + await meter.nativeReservationsToday() + await meter.classificationReservationsToday() + (estimatedNextCallUsd ?? 0)
  if (projected >= settings.dailyBudgetUsd) {
    throw new BudgetExceededError(spentUsd, settings.dailyBudgetUsd)
  }
}
