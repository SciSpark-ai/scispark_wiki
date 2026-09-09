import { describe, it, expect, vi, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import type { VaultStorage } from "../../vault/storage"
import { LEDGER_PATH, recordOrchestratorRun, readLedger, withLedger } from "../ledger"

// Wraps a MemoryVaultStorage but makes write() always reject, to exercise
// recordOrchestratorRun's "never throws to the caller" contract.
class WriteFailingStorage implements VaultStorage {
  private inner = new MemoryVaultStorage()
  async read(path: string): Promise<string | null> {
    return this.inner.read(path)
  }
  async write(): Promise<void> {
    throw new Error("simulated write failure")
  }
  async readBinary(path: string): Promise<Uint8Array | null> {
    return this.inner.readBinary(path)
  }
  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    return this.inner.writeBinary(path, data)
  }
  async delete(path: string): Promise<void> {
    return this.inner.delete(path)
  }
  async list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("recordOrchestratorRun / readLedger", () => {
  it("round-trips two records, newest first", async () => {
    const storage = new MemoryVaultStorage()

    await recordOrchestratorRun(
      storage,
      { orchestrator: "feed-refresh", trigger: "user", status: "ok" },
      () => new Date("2026-07-19T10:00:00.000Z"),
    )
    await recordOrchestratorRun(
      storage,
      { orchestrator: "trending-refresh", trigger: "schedule", status: "degraded", reason: "budget" },
      () => new Date("2026-07-19T11:00:00.000Z"),
    )

    const records = await readLedger(storage)
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({
      ts: "2026-07-19T11:00:00.000Z",
      orchestrator: "trending-refresh",
      trigger: "schedule",
      status: "degraded",
      reason: "budget",
    })
    expect(records[1]).toEqual({
      ts: "2026-07-19T10:00:00.000Z",
      orchestrator: "feed-refresh",
      trigger: "user",
      status: "ok",
    })
  })

  it("appends to the exact ledger path", async () => {
    const storage = new MemoryVaultStorage()
    await recordOrchestratorRun(
      storage,
      { orchestrator: "ingest", trigger: "user", status: "ok" },
      () => new Date("2026-07-19T10:00:00.000Z"),
    )

    expect(LEDGER_PATH).toBe(".scispark/runs/ledger.jsonl")
    const raw = await storage.read(LEDGER_PATH)
    expect(raw).not.toBeNull()
    expect((raw as string).trim().split("\n")).toHaveLength(1)
  })

  it("skips a corrupt line without throwing", async () => {
    const storage = new MemoryVaultStorage()
    const good1 = JSON.stringify({
      ts: "2026-07-19T10:00:00.000Z",
      orchestrator: "ingest",
      trigger: "user",
      status: "ok",
    })
    const good2 = JSON.stringify({
      ts: "2026-07-19T11:00:00.000Z",
      orchestrator: "lint-deterministic",
      trigger: "schedule",
      status: "ok",
    })
    await storage.write(LEDGER_PATH, [good1, "{not valid json", good2].join("\n") + "\n")

    const records = await readLedger(storage)
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.ts)).toEqual(["2026-07-19T11:00:00.000Z", "2026-07-19T10:00:00.000Z"])
  })

  it("defaults to a limit of 50, returning the most recent N newest-first", async () => {
    const storage = new MemoryVaultStorage()
    for (let i = 0; i < 60; i++) {
      await recordOrchestratorRun(
        storage,
        { orchestrator: "enrich", trigger: "user", status: "ok" },
        () => new Date(2026, 0, 1, 0, i),
      )
    }

    const records = await readLedger(storage)
    expect(records).toHaveLength(50)
    // Newest-first: the last-written record (i=59) comes first.
    expect(records[0].ts).toBe(new Date(2026, 0, 1, 0, 59).toISOString())
    expect(records[49].ts).toBe(new Date(2026, 0, 1, 0, 10).toISOString())
  })

  it("honors an explicit limit", async () => {
    const storage = new MemoryVaultStorage()
    for (let i = 0; i < 5; i++) {
      await recordOrchestratorRun(
        storage,
        { orchestrator: "spark-deep", trigger: "user", status: "ok" },
        () => new Date(2026, 0, 1, 0, i),
      )
    }

    const records = await readLedger(storage, { limit: 2 })
    expect(records).toHaveLength(2)
    expect(records[0].ts).toBe(new Date(2026, 0, 1, 0, 4).toISOString())
    expect(records[1].ts).toBe(new Date(2026, 0, 1, 0, 3).toISOString())
  })

  it("returns an empty array when the ledger file does not exist", async () => {
    const storage = new MemoryVaultStorage()
    expect(await readLedger(storage)).toEqual([])
  })

  it("swallows a storage write throw and warns instead of rejecting", async () => {
    const storage = new WriteFailingStorage()
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await expect(
      recordOrchestratorRun(
        storage,
        { orchestrator: "consolidation", trigger: "schedule", status: "ok" },
        () => new Date("2026-07-19T10:00:00.000Z"),
      ),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalled()
  })
})

describe("withLedger", () => {
  it("records the returned status/cost/meta on success and returns the result", async () => {
    const storage = new MemoryVaultStorage()

    const result = await withLedger(
      storage,
      { orchestrator: "feed-refresh", trigger: "user", now: () => new Date("2026-07-19T10:00:00.000Z") },
      async () => ({
        result: { candidates: 12 },
        status: "ok" as const,
        costUsd: 0.05,
        meta: { candidates: 12 },
      }),
    )

    expect(result).toEqual({ candidates: 12 })

    const records = await readLedger(storage)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({
      ts: "2026-07-19T10:00:00.000Z",
      orchestrator: "feed-refresh",
      trigger: "user",
      status: "ok",
      costUsd: 0.05,
      meta: { candidates: 12 },
    })
  })

  it("records a failed status with the error message and rethrows on throw", async () => {
    const storage = new MemoryVaultStorage()

    await expect(
      withLedger(
        storage,
        {
          orchestrator: "spark-deep",
          trigger: "user",
          now: () => new Date("2026-07-19T10:00:00.000Z"),
        },
        async () => {
          throw new Error("scoop-check exploded")
        },
      ),
    ).rejects.toThrow("scoop-check exploded")

    const records = await readLedger(storage)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({
      ts: "2026-07-19T10:00:00.000Z",
      orchestrator: "spark-deep",
      trigger: "user",
      status: "failed",
      reason: "scoop-check exploded",
    })
  })

  it("rethrows even when the thrown value is not an Error, still recording a failed status", async () => {
    const storage = new MemoryVaultStorage()

    await expect(
      withLedger(storage, { orchestrator: "lint-llm", trigger: "schedule" }, async () => {
        throw "not-an-error-object"
      }),
    ).rejects.toBe("not-an-error-object")

    const records = await readLedger(storage)
    expect(records).toHaveLength(1)
    expect(records[0].status).toBe("failed")
    expect(records[0].reason).toBe("not-an-error-object")
  })
})
