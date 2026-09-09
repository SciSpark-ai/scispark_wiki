import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import type { UsageRecord } from "../../llm/metering"
import { recordOrchestratorRun } from "../../runs/ledger"
import { logEvent } from "../../events/log"
import type { Changeset } from "../../vault/types"
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
      // A billed unpriced call makes the total unknown, not zero.
      rec({ ts: `${today}T04:00:00.000Z`, skill: "ingest", costUsd: null }),
    ]
    await storage.write(`.scispark/usage/${today}.jsonl`, jsonlWithCorruptLine(records))
    await saveSettings(storage, { ...DEFAULT_SETTINGS, dailyBudgetUsd: 9.5 })

    const res = await usageRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.budgetUsd).toBe(9.5)
    // corrupt line skipped; the four valid records aggregate correctly
    expect(body.summary.today.totalUsd).toBeNull()
    expect(body.summary.today.bySkill).toEqual([
      { skill: "feed", totalUsd: 5 },
      { skill: "digest", totalUsd: 3 },
      { skill: "ingest", totalUsd: null },
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

  it("response includes acceptance (per-skill cost-per-accepted-change) and recentRuns from the ledger", async () => {
    await saveSettings(storage, { ...DEFAULT_SETTINGS, dailyBudgetUsd: 5 })

    const cs1: Changeset = {
      id: "cs-applied-1",
      skill: "ingest",
      model: "tier:strong",
      timestamp: `${today}T01:00:00.000Z`,
      changes: [{ path: "wiki/papers/p1.md", before: null, after: "content" }],
    }
    const cs2: Changeset = {
      id: "cs-applied-2",
      skill: "ingest",
      model: "tier:strong",
      timestamp: `${today}T02:00:00.000Z`,
      changes: [{ path: "wiki/papers/p2.md", before: null, after: "content" }],
    }
    await storage.write(".scispark/changesets/cs-applied-1.json", JSON.stringify(cs1))
    await storage.write(".scispark/changesets/cs-applied-2.json", JSON.stringify(cs2))

    // cs-applied-1 was reverted, recorded as a changeset_revert event.
    await logEvent(
      storage,
      { type: "changeset_revert", changesetId: "cs-applied-1", skill: "ingest" },
      () => new Date(`${today}T03:00:00.000Z`),
    )

    await storage.write(
      `.scispark/usage/${today}.jsonl`,
      JSON.stringify(rec({ ts: `${today}T00:30:00.000Z`, skill: "ingest", costUsd: 4 })) + "\n",
    )

    await recordOrchestratorRun(
      storage,
      { orchestrator: "ingest", trigger: "user", status: "ok", costUsd: 4 },
      () => new Date(`${today}T01:00:00.000Z`),
    )

    const res = await usageRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.acceptance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skill: "ingest",
          applied: 2,
          reverted: 1,
          acceptRate: 0.5,
          totalCostUsd: 4,
          costPerAcceptedUsd: 4, // 4 / (2 - 1)
        }),
      ]),
    )

    expect(body.recentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orchestrator: "ingest", trigger: "user", status: "ok", costUsd: 4 }),
      ]),
    )

    // still never leaks key material
    const bodyText = JSON.stringify(body)
    expect(bodyText).not.toMatch(/sk-/)
  })

  it("unions changeset_revert events with ingest's log.md undo entries so a revert is never double-counted", async () => {
    const cs: Changeset = {
      id: "cs-log-undo",
      skill: "ingest",
      model: "tier:strong",
      timestamp: `${today}T01:00:00.000Z`,
      changes: [{ path: "wiki/papers/p3.md", before: null, after: "content" }],
    }
    await storage.write(".scispark/changesets/cs-log-undo.json", JSON.stringify(cs))
    // Both sources record the same revert: log.md's undo entry AND a
    // changeset_revert event (undoIngest now emits both) — must count once.
    await storage.write("log.md", `# Log\n\n## [${today}] undo | cs-log-undo\n`)
    await logEvent(
      storage,
      { type: "changeset_revert", changesetId: "cs-log-undo", skill: "ingest" },
      () => new Date(`${today}T02:00:00.000Z`),
    )

    const res = await usageRoute.GET()
    const body = await res.json()
    const ingestEntry = body.acceptance.find((a: { skill: string }) => a.skill === "ingest")
    expect(ingestEntry.applied).toBe(1)
    expect(ingestEntry.reverted).toBe(1)
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
