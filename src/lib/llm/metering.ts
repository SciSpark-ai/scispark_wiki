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

export class Meter {
  constructor(
    private storage: VaultStorage,
    private now: () => Date = () => new Date(),
  ) {}

  async record(r: Omit<UsageRecord, "ts" | "costUsd">): Promise<UsageRecord> {
    const nowDate = this.now()
    const rec: UsageRecord = {
      ...r,
      ts: nowDate.toISOString(),
      costUsd: estimateCostUsd(r.model, r.usage),
    }

    const path = dayFilePath(utcDateString(nowDate))
    // JSONL append = read existing file + append line + write back. This mirrors the
    // M1 changeset serialization convention: there is a single writer (the harness
    // serializes vault-mutating operations), so a plain read-modify-write is safe
    // without an additional file lock.
    const existing = await this.storage.read(path)
    const next = (existing ?? "") + JSON.stringify(rec) + "\n"
    await this.storage.write(path, next)

    return rec
  }

  async recordsForDay(date: string): Promise<UsageRecord[]> {
    const raw = await this.storage.read(dayFilePath(date))
    if (raw == null) return []
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as UsageRecord)
  }

  async spentTodayUsd(): Promise<number> {
    const records = await this.recordsForDay(utcDateString(this.now()))
    return records.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
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
): Promise<void> {
  const spentUsd = await meter.spentTodayUsd()
  const projected = spentUsd + (estimatedNextCallUsd ?? 0)
  if (projected >= settings.dailyBudgetUsd) {
    throw new BudgetExceededError(spentUsd, settings.dailyBudgetUsd)
  }
}
