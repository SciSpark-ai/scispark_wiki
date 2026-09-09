import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { runCompanion } from "../run"
import { evaluateTriggers, type TriggerState } from "../triggers"

const start = Date.parse("2026-09-07T04:00:00Z")
function state(id = "review-1", nowMs = start): TriggerState {
  return { route: "/wiki", hasFeedCache: true, recentEvents: [], reviewCount: 1,
    reviews: [{ id, createdAt: new Date(nowMs).toISOString(), title: "Check a possible duplicate" }],
    bundle: null, lastShownTs: {}, nowMs }
}
const reply = { text: '{"utterance":"There is a possible duplicate to check."}',
  json: { utterance: "There is a possible duplicate to check." },
  usage: { inputTokens: 1, outputTokens: 1 }, model: "m", provider: "anthropic" as const, stopReason: "end_turn" as const }

describe("quiet, event-specific proactive messages", () => {
  it("does not greet users or recommend Home just because a cached feed exists", () => {
    expect(evaluateTriggers({ ...state(), route: "/", reviewCount: 0, reviews: [] })).toBeNull()
  })
  it("does not recommend the review inbox while the user is already there", () => {
    expect(evaluateTriggers({ ...state(), route: "/wiki/inbox" })).toBeNull()
  })
  it("does not revive stale reviews", () => {
    expect(evaluateTriggers({ ...state(), nowMs: start + 8 * 24 * 60 * 60_000 })).toBeNull()
  })
  it("does not repeat an event when the client count and cooldowns reset", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([reply, reply])
    const args = { storage, state: state(), sessionShownCount: 0, now: () => new Date(start), providerOverride: { fast: provider } }
    expect(await runCompanion(args)).not.toBeNull()
    expect(await runCompanion({ ...args, now: () => new Date(start + 31 * 60_000) })).toBeNull()
    expect(provider.calls).toHaveLength(1)
  })
  it("allows only one concurrent tab to claim an event", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([reply, reply])
    const args = { storage, state: state(), sessionShownCount: 0, now: () => new Date(start), providerOverride: { fast: provider } }
    const results = await Promise.all([runCompanion(args), runCompanion(args)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(provider.calls).toHaveLength(1)
  })
  it("applies a shared 30-minute gap and two-per-24-hour default budget", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([reply, reply, reply, reply])
    const run = (id: string, minutes: number) => runCompanion({ storage,
      state: state(id, start + minutes * 60_000), sessionShownCount: 0,
      now: () => new Date(start + minutes * 60_000), providerOverride: { fast: provider } })
    expect(await run("one", 0)).not.toBeNull()
    expect(await run("two", 1)).toBeNull()
    expect(await run("two", 31)).not.toBeNull()
    expect(await run("three", 62)).toBeNull()
    expect(provider.calls).toHaveLength(2)
  })
  it("fails quiet if the delivery ledger is corrupt", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/companion-delivery.json", "broken JSON")
    const provider = new MockProvider([reply])
    expect(await runCompanion({ storage, state: state(), sessionShownCount: 0,
      now: () => new Date(start), providerOverride: { fast: provider } })).toBeNull()
    expect(provider.calls).toHaveLength(0)
  })
  it("does not recommend an item after its destination was visited", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([reply])
    const args = { storage, state: { ...state(), route: "/wiki/inbox" }, sessionShownCount: 0,
      now: () => new Date(start), providerOverride: { fast: provider } }
    expect(await runCompanion(args)).toBeNull()
    expect(await runCompanion({ ...args, state: state(), now: () => new Date(start + 60_000) })).toBeNull()
    expect(provider.calls).toHaveLength(0)
    // Viewing an item does not use the interruption budget for another event.
    expect(await runCompanion({ ...args, state: state("new-review") })).not.toBeNull()
  })
  it("retains suppression after a storage instance is reconstructed", async () => {
    const first = new MemoryVaultStorage()
    const provider = new MockProvider([reply, reply])
    const args = { state: state(), sessionShownCount: 0, now: () => new Date(start), providerOverride: { fast: provider } }
    expect(await runCompanion({ ...args, storage: first })).not.toBeNull()
    const reopened = new MemoryVaultStorage()
    for (const path of await first.list()) await reopened.write(path, (await first.read(path))!)
    expect(await runCompanion({ ...args, storage: reopened, now: () => new Date(start + 31 * 60_000) })).toBeNull()
  })
  it("allows a distinct event with the same review count, but not a resurfaced old one", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([reply, reply, reply])
    const run = (id: string, minutes: number) => runCompanion({ storage, state: state(id), sessionShownCount: 0,
      now: () => new Date(start + minutes * 60_000), providerOverride: { fast: provider } })
    expect(await run("one", 0)).not.toBeNull()
    expect(await run("two", 31)).not.toBeNull()
    expect(await run("one", 24 * 60 + 1)).toBeNull()
  })
})
