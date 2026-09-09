import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { EvaluationLedger } from "../evaluation-ledger"
import type { ScopedPrice } from "../../llm/scoped-pricing"
const price: ScopedPrice = { provider: "openai", baseUrl: "https://example.test/v1", model: "example",
  rates: { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075 },
  provenance: "fixture", recordedAt: "2026-09-07T00:00:00Z" }
describe("shared evaluation allowance", () => {
  it("survives reopening and counts failed-schema attempts like any other billed response", async () => {
    const storage = new MemoryVaultStorage()
    let ledger = await EvaluationLedger.open(storage, price)
    const id = await ledger.reserve("bad-json", 0.8)
    await ledger.settle(id, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 })
    ledger = await EvaluationLedger.open(storage, price)
    expect(ledger.totals().knownUsd).toBeCloseTo(0.4125)
    await expect(ledger.reserve("next", 1.6)).rejects.toThrow("$2")
    expect(ledger.state.attempts).toHaveLength(1)
  })
  it("retains in-flight/unknown billing and refuses automatic replay", async () => {
    const storage = new MemoryVaultStorage()
    const ledger = await EvaluationLedger.open(storage, price)
    const id = await ledger.reserve("interrupted", 0.1)
    await expect((await EvaluationLedger.open(storage, price)).reserve("restart", 0.1)).rejects.toThrow("uncertain")
    await expect(ledger.settle(id)).rejects.toThrow("uncertain")
    expect((await EvaluationLedger.open(storage, price)).totals().heldUsd).toBe(0.1)
    await expect(ledger.reserve("retry", 0.1)).rejects.toThrow("uncertain")
  })
  it("refuses corrupt ledgers and rate changes rather than resetting spend", async () => {
    const storage = new MemoryVaultStorage()
    await EvaluationLedger.open(storage, price)
    await expect(EvaluationLedger.open(storage, { ...price, rates: { inputPerMillion: 0, outputPerMillion: 0 } })).rejects.toThrow("pricing changed")
    await storage.write(".scispark/review-evaluation/allowance.json", "broken")
    await expect(EvaluationLedger.open(storage, price)).rejects.toThrow()
  })
})
