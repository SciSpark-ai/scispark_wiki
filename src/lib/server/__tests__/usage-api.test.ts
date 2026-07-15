import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import type { UsageRecord } from "../../llm/metering"
import * as usageRoute from "../../../app/api/usage/route"

const SECRET_KEY = "sk-ant-usage-secret-xyz789"

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function rec(overrides: Partial<UsageRecord> & { ts: string }): UsageRecord {
  return {
    skill: "digest",
    runId: "run-1",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    usage: { inputTokens: 100, outputTokens: 100 },
    costUsd: 1,
    ...overrides,
  }
}

/** Serializes a set of records to a JSONL file, injecting a corrupt line in
 * the middle so the route's tolerance is exercised end-to-end. */
function jsonlWithCorruptLine(records: UsageRecord[]): string {
  const lines = records.map((r) => JSON.stringify(r))
  lines.splice(1, 0, "{not valid json at all,,,")
  return lines.join("\n") + "\n"
}

describe("usage API", () => {
  let storage: MemoryVaultStorage
  const today = utcDateString(new Date())

  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })
  afterEach(() => {
    setServerVaultForTests(null)
  })

  it("aggregates today's records (total, per-skill, unpriced) and returns the budget", async () => {
    const records = [
      rec({ ts: `${today}T01:00:00.000Z`, skill: "digest", costUsd: 1 }),
      rec({ ts: `${today}T02:00:00.000Z`, skill: "digest", costUsd: 2 }),
      rec({ ts: `${today}T03:00:00.000Z`, skill: "feed", costUsd: 5 }),
      // a null-cost record: counted in unpricedCount, contributes 0 to totals
      rec({ ts: `${today}T04:00:00.000Z`, skill: "ingest", costUsd: null }),
    ]
    await storage.write(`.scispark/usage/${today}.jsonl`, jsonlWithCorruptLine(records))
    await saveSettings(storage, { ...DEFAULT_SETTINGS, dailyBudgetUsd: 9.5 })

    const res = await usageRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.budgetUsd).toBe(9.5)
    // corrupt line skipped; the four valid records aggregate correctly
    expect(body.summary.today.totalUsd).toBeCloseTo(8, 6)
    expect(body.summary.today.bySkill).toEqual([
      { skill: "feed", totalUsd: 5 },
      { skill: "digest", totalUsd: 3 },
      { skill: "ingest", totalUsd: 0 },
    ])
    expect(body.summary.unpricedCount).toBe(1)
    expect(body.summary.days).toHaveLength(7)
    expect(body.summary.days[body.summary.days.length - 1].date).toBe(today)
  })

  it("reads across multiple day-files in the usage dir", async () => {
    const yesterday = utcDateString(new Date(Date.now() - 24 * 60 * 60 * 1000))
    await storage.write(
      `.scispark/usage/${today}.jsonl`,
      JSON.stringify(rec({ ts: `${today}T05:00:00.000Z`, costUsd: 2 })) + "\n",
    )
    await storage.write(
      `.scispark/usage/${yesterday}.jsonl`,
      JSON.stringify(rec({ ts: `${yesterday}T05:00:00.000Z`, costUsd: 3 })) + "\n",
    )
    // a non-jsonl sibling file must be ignored
    await storage.write(`.scispark/usage/README.txt`, "not a ledger")

    const res = await usageRoute.GET()
    const body = await res.json()
    const byDate = Object.fromEntries(
      body.summary.days.map((d: { date: string; totalUsd: number }) => [d.date, d.totalUsd]),
    )
    expect(byDate[today]).toBe(2)
    expect(byDate[yesterday]).toBe(3)
    expect(body.summary.today.totalUsd).toBe(2)
  })

  it("never leaks API-key material in the response even when settings.json holds a key", async () => {
    await saveSettings(storage, {
      ...DEFAULT_SETTINGS,
      keys: { anthropic: SECRET_KEY },
      dailyBudgetUsd: 4,
    })
    await storage.write(
      `.scispark/usage/${today}.jsonl`,
      JSON.stringify(rec({ ts: `${today}T06:00:00.000Z`, costUsd: 1 })) + "\n",
    )

    const res = await usageRoute.GET()
    const bodyText = await res.text()
    expect(bodyText).not.toContain(SECRET_KEY)
    const body = JSON.parse(bodyText)
    expect(body.budgetUsd).toBe(4)
  })

  it("returns an empty-but-valid summary when no usage files exist", async () => {
    await saveSettings(storage, { ...DEFAULT_SETTINGS, dailyBudgetUsd: 5 })
    const res = await usageRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.budgetUsd).toBe(5)
    expect(body.summary.today.totalUsd).toBe(0)
    expect(body.summary.today.bySkill).toEqual([])
    expect(body.summary.unpricedCount).toBe(0)
    expect(body.summary.days).toHaveLength(7)
  })

  it("storage failure → 500 with a JSON {error}, no key leakage", async () => {
    class ThrowingStorage extends MemoryVaultStorage {
      async list(): Promise<string[]> {
        throw new Error("simulated list failure")
      }
    }
    setServerVaultForTests(new ThrowingStorage())
    const res = await usageRoute.GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toHaveProperty("error")
    expect(body.error).toMatch(/failure/)
  })
})
