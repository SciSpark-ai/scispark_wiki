import { describe, it, expect, vi, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import type { SearchFn } from "../../skills/feed"
import { recordOrchestratorRun, readLedger } from "../../runs/ledger"
import { REFRESH_FAILURE_PATH, type maybeAutoRefreshTrending } from "../../trending/auto-refresh"
import type { runConsolidation } from "../../skills/consolidation"
import type { runLintDeterministic } from "../../lint/run"
import type { LintFinding } from "../../lint/types"
import { runHeartbeatTick, startHeartbeat } from "../heartbeat"

const fakeSearchFn: SearchFn = async () => []

function makeFakeTrending(
  result: "refreshed" | "fresh" | "no-fields" | "backoff" | "failed",
): typeof maybeAutoRefreshTrending {
  return (async () => result) as unknown as typeof maybeAutoRefreshTrending
}

function makeFakeConsolidation(result: {
  status: "skipped" | "unchanged" | "applied"
  changesetId?: string
  costUsd?: number
  runId?: string
}): typeof runConsolidation {
  return (async () => result) as unknown as typeof runConsolidation
}

function makeFakeLint(result: { findings: LintFinding[]; reviewIds: string[] }): typeof runLintDeterministic {
  return (async () => result) as unknown as typeof runLintDeterministic
}

function makeThrowingFake<T>(message: string): T {
  return (async () => {
    throw new Error(message)
  }) as unknown as T
}

describe("runHeartbeatTick", () => {
  const FIXED_NOW = new Date("2026-07-19T12:00:00.000Z")

  it("runs all three jobs and leaves a trigger:\"schedule\" ledger record for each", async () => {
    const storage = new MemoryVaultStorage()
    await runHeartbeatTick({
      storage,
      searchFn: fakeSearchFn,
      now: () => FIXED_NOW,
      jobs: {
        maybeAutoRefreshTrending: makeFakeTrending("refreshed"),
        runConsolidation: makeFakeConsolidation({ status: "applied", changesetId: "cs1", costUsd: 0.02 }),
        runLintDeterministic: makeFakeLint({ findings: [], reviewIds: [] }),
      },
    })

    const records = await readLedger(storage)
    expect(records).toHaveLength(3)
    expect(records.every((r) => r.trigger === "schedule")).toBe(true)

    const byOrchestrator = Object.fromEntries(records.map((r) => [r.orchestrator, r]))
    expect(byOrchestrator["trending-refresh"].status).toBe("ok")
    expect(byOrchestrator["consolidation"].status).toBe("ok")
    expect(byOrchestrator["consolidation"].reason).toBe("applied")
    expect(byOrchestrator["consolidation"].costUsd).toBe(0.02)
    expect(byOrchestrator["lint-deterministic"].status).toBe("ok")
  })

  it("a job-2 (consolidation) throw does not prevent job 3 (lint) from running", async () => {
    const storage = new MemoryVaultStorage()
    await runHeartbeatTick({
      storage,
      searchFn: fakeSearchFn,
      now: () => FIXED_NOW,
      jobs: {
        maybeAutoRefreshTrending: makeFakeTrending("fresh"),
        runConsolidation: makeThrowingFake<typeof runConsolidation>("consolidation exploded"),
        runLintDeterministic: makeFakeLint({ findings: [], reviewIds: [] }),
      },
    })

    const records = await readLedger(storage)
    const byOrchestrator = Object.fromEntries(records.map((r) => [r.orchestrator, r]))
    expect(byOrchestrator["consolidation"].status).toBe("failed")
    expect(byOrchestrator["consolidation"].reason).toBe("consolidation exploded")
    // Job 3 still ran and left its own record, proving job 2's throw didn't stop the tick.
    expect(byOrchestrator["lint-deterministic"]).toBeDefined()
    expect(byOrchestrator["lint-deterministic"].status).toBe("ok")
  })

  it("never throws to the caller even when every job fails", async () => {
    const storage = new MemoryVaultStorage()
    await expect(
      runHeartbeatTick({
        storage,
        searchFn: fakeSearchFn,
        now: () => FIXED_NOW,
        jobs: {
          maybeAutoRefreshTrending: makeThrowingFake<typeof maybeAutoRefreshTrending>("trending exploded"),
          runConsolidation: makeThrowingFake<typeof runConsolidation>("consolidation exploded"),
          runLintDeterministic: makeThrowingFake<typeof runLintDeterministic>("lint exploded"),
        },
      }),
    ).resolves.toBeUndefined()

    const records = await readLedger(storage)
    expect(records).toHaveLength(3)
    expect(records.every((r) => r.status === "failed")).toBe(true)
  })

  it("skips the lint job silently (no new ledger record) when the last lint-deterministic record is fresh", async () => {
    const storage = new MemoryVaultStorage()
    const seededAt = new Date("2026-07-19T00:00:00.000Z")
    await recordOrchestratorRun(
      storage,
      { orchestrator: "lint-deterministic", trigger: "user", status: "ok" },
      () => seededAt,
    )

    const lintFake = vi.fn(async () => ({ findings: [] as LintFinding[], reviewIds: [] as string[] }))
    await runHeartbeatTick({
      storage,
      searchFn: fakeSearchFn,
      now: () => new Date("2026-07-19T01:00:00.000Z"), // 1h after the seeded record — well under the 24h gate
      jobs: {
        maybeAutoRefreshTrending: makeFakeTrending("fresh"),
        runConsolidation: makeFakeConsolidation({ status: "skipped" }),
        runLintDeterministic: lintFake as unknown as typeof runLintDeterministic,
      },
    })

    expect(lintFake).not.toHaveBeenCalled()
    const records = await readLedger(storage)
    const lintRecords = records.filter((r) => r.orchestrator === "lint-deterministic")
    // Only the seeded record — the heartbeat must not have written a "skipped" row.
    expect(lintRecords).toHaveLength(1)
  })

  it("runs the lint job when the last lint-deterministic record is 25h old", async () => {
    const storage = new MemoryVaultStorage()
    const seededAt = new Date("2026-07-19T00:00:00.000Z")
    await recordOrchestratorRun(
      storage,
      { orchestrator: "lint-deterministic", trigger: "schedule", status: "ok" },
      () => seededAt,
    )

    const lintFake = vi.fn(async () => ({ findings: [] as LintFinding[], reviewIds: [] as string[] }))
    await runHeartbeatTick({
      storage,
      searchFn: fakeSearchFn,
      now: () => new Date("2026-07-20T01:00:00.000Z"), // 25h after the seeded record
      jobs: {
        maybeAutoRefreshTrending: makeFakeTrending("fresh"),
        runConsolidation: makeFakeConsolidation({ status: "skipped" }),
        runLintDeterministic: lintFake as unknown as typeof runLintDeterministic,
      },
    })

    expect(lintFake).toHaveBeenCalledTimes(1)
    const records = await readLedger(storage)
    const lintRecords = records.filter((r) => r.orchestrator === "lint-deterministic")
    expect(lintRecords).toHaveLength(2)
    expect(lintRecords[0].trigger).toBe("schedule")
  })

  it("maps a trending \"failed\" status using the failure marker's lastError as reason", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      REFRESH_FAILURE_PATH,
      JSON.stringify({ lastFailureAt: FIXED_NOW.toISOString(), consecutiveFailures: 1, lastError: "arxiv 503" }),
    )
    await runHeartbeatTick({
      storage,
      searchFn: fakeSearchFn,
      now: () => FIXED_NOW,
      jobs: {
        maybeAutoRefreshTrending: makeFakeTrending("failed"),
        runConsolidation: makeFakeConsolidation({ status: "skipped" }),
        runLintDeterministic: makeFakeLint({ findings: [], reviewIds: [] }),
      },
    })

    const records = await readLedger(storage)
    const trendingRecord = records.find((r) => r.orchestrator === "trending-refresh")
    expect(trendingRecord?.status).toBe("failed")
    expect(trendingRecord?.reason).toBe("arxiv 503")
  })
})

describe("startHeartbeat", () => {
  const HEARTBEAT_KEY = Symbol.for("scispark.heartbeat")

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[HEARTBEAT_KEY]
    delete process.env.SCISPARK_SCHEDULER
    vi.useRealTimers()
  })

  it("returns the same stop-function identity on a second call (singleton guard)", () => {
    vi.useFakeTimers()
    const stop1 = startHeartbeat()
    const stop2 = startHeartbeat()
    expect(stop2).toBe(stop1)
    stop1()
  })

  it("kill switch: SCISPARK_SCHEDULER=off returns a noop without touching globalThis", () => {
    process.env.SCISPARK_SCHEDULER = "off"
    vi.useFakeTimers()
    const stop = startHeartbeat()
    expect(typeof stop).toBe("function")
    expect((globalThis as Record<symbol, unknown>)[HEARTBEAT_KEY]).toBeUndefined()
    expect(() => stop()).not.toThrow()
  })
})
