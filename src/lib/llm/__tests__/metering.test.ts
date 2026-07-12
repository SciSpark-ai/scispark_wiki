import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { Meter, checkBudget, BudgetExceededError } from "../metering"
import { DEFAULT_SETTINGS } from "../settings"
import { LLMError } from "../types"

const haikuUsage = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens })

describe("Meter", () => {
  describe("record + spentTodayUsd", () => {
    it("sums the exact cost of two haiku calls and writes 2 JSONL lines to the day file", async () => {
      const storage = new MemoryVaultStorage()
      const fixedNow = () => new Date("2026-07-12T10:00:00.000Z")
      const meter = new Meter(storage, fixedNow)

      // claude-haiku-4-5: $1/M in, $5/M out
      await meter.record({
        skill: "digest", runId: "run-1", provider: "anthropic", model: "claude-haiku-4-5",
        usage: haikuUsage(1_000_000, 200_000),
      })
      await meter.record({
        skill: "feed", runId: "run-2", provider: "anthropic", model: "claude-haiku-4-5",
        usage: haikuUsage(500_000, 100_000),
      })

      // call 1: $1 + $1 = $2; call 2: $0.5 + $0.5 = $1
      expect(await meter.spentTodayUsd()).toBeCloseTo(3, 6)

      const raw = await storage.read(".scispark/usage/2026-07-12.jsonl")
      expect(raw).not.toBeNull()
      const lines = (raw as string).split("\n").filter((l) => l.trim().length > 0)
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]).costUsd).toBeCloseTo(2, 6)
      expect(JSON.parse(lines[1]).costUsd).toBeCloseTo(1, 6)
    })

    it("stamps ts and returns the persisted record shape", async () => {
      const storage = new MemoryVaultStorage()
      const meter = new Meter(storage, () => new Date("2026-07-12T10:00:00.000Z"))
      const rec = await meter.record({
        skill: "digest", runId: "run-1", provider: "anthropic", model: "claude-haiku-4-5",
        usage: haikuUsage(1000, 1000),
      })
      expect(rec.ts).toBe("2026-07-12T10:00:00.000Z")
      expect(rec.skill).toBe("digest")
      expect(rec.runId).toBe("run-1")
      expect(rec.provider).toBe("anthropic")
      expect(rec.model).toBe("claude-haiku-4-5")
      expect(rec.costUsd).toBeCloseTo(0.001 + 0.005, 6)
    })
  })

  describe("day rollover", () => {
    it("isolates spend per UTC day and recordsForDay returns the right day's records", async () => {
      const storage = new MemoryVaultStorage()
      let current = new Date("2026-07-12T23:00:00.000Z")
      const meter = new Meter(storage, () => current)

      await meter.record({
        skill: "digest", runId: "run-1", provider: "anthropic", model: "claude-haiku-4-5",
        usage: haikuUsage(1_000_000, 0),
      })

      // advance into the next UTC day
      current = new Date("2026-07-13T01:00:00.000Z")
      await meter.record({
        skill: "digest", runId: "run-2", provider: "anthropic", model: "claude-haiku-4-5",
        usage: haikuUsage(2_000_000, 0),
      })

      // spentTodayUsd on day 2 only counts day 2's record ($2)
      expect(await meter.spentTodayUsd()).toBeCloseTo(2, 6)

      const day1Records = await meter.recordsForDay("2026-07-12")
      expect(day1Records).toHaveLength(1)
      expect(day1Records[0].runId).toBe("run-1")
      expect(day1Records[0].costUsd).toBeCloseTo(1, 6)

      const day2Records = await meter.recordsForDay("2026-07-13")
      expect(day2Records).toHaveLength(1)
      expect(day2Records[0].runId).toBe("run-2")
    })

    it("recordsForDay returns an empty array for a day with no file", async () => {
      const storage = new MemoryVaultStorage()
      const meter = new Meter(storage)
      expect(await meter.recordsForDay("2020-01-01")).toEqual([])
    })
  })

  describe("unknown model pricing", () => {
    it("records costUsd: null for an unpriced model and leaves spentTodayUsd unchanged", async () => {
      const storage = new MemoryVaultStorage()
      const meter = new Meter(storage, () => new Date("2026-07-12T10:00:00.000Z"))

      const rec = await meter.record({
        skill: "digest", runId: "run-1", provider: "anthropic", model: "mystery-model",
        usage: haikuUsage(1_000_000, 1_000_000),
      })
      expect(rec.costUsd).toBeNull()
      expect(await meter.spentTodayUsd()).toBe(0)

      // and it's still persisted as a JSONL line (not dropped)
      const day = await meter.recordsForDay("2026-07-12")
      expect(day).toHaveLength(1)
      expect(day[0].costUsd).toBeNull()
    })
  })
})

describe("checkBudget", () => {
  it("passes when spend is under the daily budget", async () => {
    const storage = new MemoryVaultStorage()
    const meter = new Meter(storage, () => new Date("2026-07-12T10:00:00.000Z"))
    await meter.record({
      skill: "digest", runId: "run-1", provider: "anthropic", model: "claude-haiku-4-5",
      usage: haikuUsage(100_000, 0),
    })
    const settings = { ...DEFAULT_SETTINGS, dailyBudgetUsd: 5 }
    await expect(checkBudget(meter, settings)).resolves.toBeUndefined()
  })

  it("throws BudgetExceededError (with spentUsd/budgetUsd) once spend is at or over budget", async () => {
    const storage = new MemoryVaultStorage()
    const meter = new Meter(storage, () => new Date("2026-07-12T10:00:00.000Z"))
    // claude-haiku-4-5 $1/M in -> exactly $5 spent for a $5 budget (at threshold)
    await meter.record({
      skill: "digest", runId: "run-1", provider: "anthropic", model: "claude-haiku-4-5",
      usage: haikuUsage(5_000_000, 0),
    })
    const settings = { ...DEFAULT_SETTINGS, dailyBudgetUsd: 5 }

    try {
      await checkBudget(meter, settings)
      expect.unreachable("expected checkBudget to throw")
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError)
      expect(e).toBeInstanceOf(LLMError)
      expect((e as BudgetExceededError).spentUsd).toBeCloseTo(5, 6)
      expect((e as BudgetExceededError).budgetUsd).toBe(5)
    }
  })

  it("factors the estimated next-call cost, pushing an under-budget spend over", async () => {
    const storage = new MemoryVaultStorage()
    const meter = new Meter(storage, () => new Date("2026-07-12T10:00:00.000Z"))
    await meter.record({
      skill: "digest", runId: "run-1", provider: "anthropic", model: "claude-haiku-4-5",
      usage: haikuUsage(4_000_000, 0), // $4 spent
    })
    const settings = { ...DEFAULT_SETTINGS, dailyBudgetUsd: 5 }

    // under budget with no estimate
    await expect(checkBudget(meter, settings)).resolves.toBeUndefined()

    // an estimate of $1.50 pushes projected spend to $5.50 >= $5 budget
    await expect(checkBudget(meter, settings, 1.5)).rejects.toThrow(BudgetExceededError)
  })
})
