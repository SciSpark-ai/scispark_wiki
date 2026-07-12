import { describe, it, expect } from "vitest"
import { z } from "zod"
import type { VaultStorage } from "../../vault/storage"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { Meter } from "../../llm/metering"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import { LLMAuthError, LLMTransientError, type LLMResult } from "../../llm/types"
import { MockProvider } from "../../llm/mock-provider"
import { defineSkill } from "../types"
import { runSkill } from "../runner"

/** Test double: forwards to `inner`, but throws on write() for any path starting with `failPrefix`. */
class FailingWriteStorage implements VaultStorage {
  constructor(
    private inner: VaultStorage,
    private failPrefix: string,
  ) {}
  read(path: string): Promise<string | null> {
    return this.inner.read(path)
  }
  async write(path: string, content: string): Promise<void> {
    if (path.startsWith(this.failPrefix)) {
      throw new Error(`simulated write failure for ${path}`)
    }
    return this.inner.write(path, content)
  }
  delete(path: string): Promise<void> {
    return this.inner.delete(path)
  }
  list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
}

const NOW = () => new Date("2026-07-12T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const result = (overrides: Partial<LLMResult>): LLMResult => ({
  text: "ok",
  usage: { inputTokens: 10, outputTokens: 5 },
  model: "claude-haiku-4-5",
  provider: "anthropic",
  stopReason: "end_turn",
  ...overrides,
})

describe("runSkill", () => {
  it("happy path: runs a skill making one fast + one strong call, aggregates usage, persists run record, meters both calls", async () => {
    const storage = new MemoryVaultStorage()
    const fastProvider = new MockProvider([
      result({ text: "fast-reply", model: "claude-haiku-4-5", usage: { inputTokens: 10, outputTokens: 5 } }),
    ])
    const strongProvider = new MockProvider([
      result({ text: "strong-reply", model: "claude-opus-4-8", usage: { inputTokens: 20, outputTokens: 8 } }),
    ])

    const skill = defineSkill<{ topic: string }, string>({
      name: "test-skill",
      version: "1.0.0",
      async run(ctx, input) {
        ctx.log(`starting for ${input.topic}`)
        const fast = await ctx.llm("fast", { messages: [{ role: "user", content: "quick" }] })
        const strong = await ctx.llm("strong", { messages: [{ role: "user", content: "deep" }] })
        return `${fast.text}/${strong.text}`
      },
    })

    const run = await runSkill({
      skill,
      input: { topic: "gravity" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: fastProvider, strong: strongProvider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toBe("fast-reply/strong-reply")
    expect(run.skill).toBe("test-skill")
    expect(run.usage).toEqual({ inputTokens: 30, outputTokens: 13 })
    expect(run.costUsd).toBeGreaterThan(0)
    expect(run.logs).toContain("starting for gravity")

    const persisted = await storage.read(`.scispark/runs/${run.runId}.json`)
    expect(persisted).not.toBeNull()
    expect(JSON.parse(persisted as string)).toEqual(run)

    const meter = new Meter(storage, NOW)
    const records = await meter.recordsForDay("2026-07-12")
    expect(records).toHaveLength(2)
    expect(records.every((r) => r.skill === "test-skill" && r.runId === run.runId)).toBe(true)
    expect(fastProvider.calls).toHaveLength(1)
    expect(strongProvider.calls).toHaveLength(1)
  })

  it("budget exceeded: skill's ctx.llm call throws BudgetExceededError, status is budget_exceeded, provider never called", async () => {
    const storage = new MemoryVaultStorage()
    const meter = new Meter(storage, NOW)
    // Pre-record spend that already blows past a tiny daily budget.
    await meter.record({
      skill: "other-skill",
      runId: "run-prior",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { inputTokens: 1_000, outputTokens: 1_000 },
    })

    const provider = new MockProvider([result({})])

    const skill = defineSkill<void, string>({
      name: "budget-test-skill",
      version: "1.0.0",
      async run(ctx) {
        const r = await ctx.llm("fast", { messages: [{ role: "user", content: "hi" }] })
        return r.text
      },
    })

    const run = await runSkill({
      skill,
      input: undefined,
      storage,
      settings: settingsWithKeys({ dailyBudgetUsd: 0.000001 }),
      providerOverride: { fast: provider, strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("budget_exceeded")
    expect(provider.calls).toHaveLength(0)
    expect(run.usage).toEqual({ inputTokens: 0, outputTokens: 0 })

    const persisted = await storage.read(`.scispark/runs/${run.runId}.json`)
    expect(persisted).not.toBeNull()
    expect(JSON.parse(persisted as string).status).toBe("budget_exceeded")
  })

  it("provider throws a non-retryable LLMAuthError: status error, error message captured, usage from prior successful call preserved", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([
      result({ text: "first-ok", usage: { inputTokens: 7, outputTokens: 3 } }),
      new LLMAuthError("invalid api key"),
    ])

    const skill = defineSkill<void, string>({
      name: "error-test-skill",
      version: "1.0.0",
      async run(ctx) {
        const first = await ctx.llm("fast", { messages: [{ role: "user", content: "one" }] })
        await ctx.llm("fast", { messages: [{ role: "user", content: "two" }] })
        return first.text
      },
    })

    const run = await runSkill({
      skill,
      input: undefined,
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider, strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("error")
    expect(run.error).toContain("invalid api key")
    expect(run.output).toBeUndefined()
    expect(run.usage).toEqual({ inputTokens: 7, outputTokens: 3 })

    const persisted = await storage.read(`.scispark/runs/${run.runId}.json`)
    expect(persisted).not.toBeNull()
    expect(JSON.parse(persisted as string).status).toBe("error")
  })

  it("llmStructured validates provider JSON against the schema and meters the call", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([
      result({ text: JSON.stringify({ x: 42 }), usage: { inputTokens: 15, outputTokens: 6 } }),
    ])

    const schema = z.object({ x: z.number() })

    const skill = defineSkill<void, { x: number }>({
      name: "structured-test-skill",
      version: "1.0.0",
      async run(ctx) {
        return ctx.llmStructured("strong", { messages: [{ role: "user", content: "give json" }] }, schema)
      },
    })

    const run = await runSkill({
      skill,
      input: undefined,
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual({ x: 42 })
    expect(run.usage).toEqual({ inputTokens: 15, outputTokens: 6 })

    const meter = new Meter(storage, NOW)
    const records = await meter.recordsForDay("2026-07-12")
    expect(records).toHaveLength(1)
    expect(records[0].skill).toBe("structured-test-skill")
    expect(records[0].runId).toBe(run.runId)
  })

  it("two concurrent runSkill calls sharing one storage: union of both runs' meter records is complete (no lost lines)", async () => {
    const storage = new MemoryVaultStorage()

    const makeSkill = (name: string) =>
      defineSkill<void, string>({
        name,
        version: "1.0.0",
        async run(ctx) {
          const r = await ctx.llm("fast", { messages: [{ role: "user", content: "hi" }] })
          return r.text
        },
      })

    const providerA = new MockProvider([result({ text: "a-reply" })])
    const providerB = new MockProvider([result({ text: "b-reply" })])

    const [runA, runB] = await Promise.all([
      runSkill({
        skill: makeSkill("skill-a"),
        input: undefined,
        storage,
        settings: settingsWithKeys(),
        providerOverride: { fast: providerA },
        now: NOW,
      }),
      runSkill({
        skill: makeSkill("skill-b"),
        input: undefined,
        storage,
        settings: settingsWithKeys(),
        providerOverride: { fast: providerB },
        now: NOW,
      }),
    ])

    expect(runA.status).toBe("ok")
    expect(runB.status).toBe("ok")

    const meter = new Meter(storage, NOW)
    const records = await meter.recordsForDay("2026-07-12")
    const runIds = new Set(records.map((r) => r.runId))
    expect(records).toHaveLength(2)
    expect(runIds.has(runA.runId)).toBe(true)
    expect(runIds.has(runB.runId)).toBe(true)
  })

  it("metering failure: meter.record write fails, run still returns ok with totals intact and a 'metering failed' log", async () => {
    const inner = new MemoryVaultStorage()
    const storage = new FailingWriteStorage(inner, ".scispark/usage/")
    const provider = new MockProvider([
      result({ text: "ok-reply", usage: { inputTokens: 9, outputTokens: 4 } }),
    ])

    const skill = defineSkill<void, string>({
      name: "metering-fail-skill",
      version: "1.0.0",
      async run(ctx) {
        const r = await ctx.llm("fast", { messages: [{ role: "user", content: "hi" }] })
        return r.text
      },
    })

    const run = await runSkill({
      skill,
      input: undefined,
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toBe("ok-reply")
    expect(run.usage).toEqual({ inputTokens: 9, outputTokens: 4 })
    expect(run.costUsd).toBeGreaterThan(0)
    expect(run.logs.some((l) => l.startsWith("metering failed:"))).toBe(true)

    // the run record itself still persists — only usage/ writes fail
    const persisted = await inner.read(`.scispark/runs/${run.runId}.json`)
    expect(persisted).not.toBeNull()
    expect(JSON.parse(persisted as string).status).toBe("ok")
  })

  it("run-record persist failure: final storage.write fails, runSkill still returns a coherent ok result with a persist-failure log", async () => {
    const inner = new MemoryVaultStorage()
    const storage = new FailingWriteStorage(inner, ".scispark/runs/")
    const provider = new MockProvider([result({ text: "ok-reply2" })])

    const skill = defineSkill<void, string>({
      name: "persist-fail-skill",
      version: "1.0.0",
      async run(ctx) {
        const r = await ctx.llm("fast", { messages: [{ role: "user", content: "hi" }] })
        return r.text
      },
    })

    const run = await runSkill({
      skill,
      input: undefined,
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toBe("ok-reply2")
    expect(run.logs.some((l) => l.startsWith("run record persist failed:"))).toBe(true)

    // meter record still succeeded — only runs/ writes fail
    const meter = new Meter(inner, NOW)
    const records = await meter.recordsForDay("2026-07-12")
    expect(records).toHaveLength(1)
  })

  it("meters ctx.llm on the requested model, not a provider-echoed dated snapshot id (budget regression)", async () => {
    const storage = new MemoryVaultStorage()
    // Settings resolve "fast" to "claude-haiku-4-5" (DEFAULT_SETTINGS), but the
    // provider echoes back a dated snapshot id, as real providers do in production.
    const provider = new MockProvider([
      result({ model: "claude-haiku-4-5-20990101", usage: { inputTokens: 10, outputTokens: 5 } }),
    ])

    const skill = defineSkill<void, string>({
      name: "echoed-model-skill",
      version: "1.0.0",
      async run(ctx) {
        const r = await ctx.llm("fast", { messages: [{ role: "user", content: "hi" }] })
        return r.text
      },
    })

    const run = await runSkill({
      skill,
      input: undefined,
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")

    const meter = new Meter(storage, NOW)
    const records = await meter.recordsForDay("2026-07-12")
    expect(records).toHaveLength(1)
    expect(records[0].model).toBe("claude-haiku-4-5")
    expect(records[0].costUsd).not.toBeNull()
    expect(await meter.spentTodayUsd()).toBeGreaterThan(0)
  })

  it("ctx.llmStructured retries a transient provider error, same as ctx.llm (retry parity)", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([
      new LLMTransientError("temporary blip"),
      result({ text: JSON.stringify({ x: 7 }), usage: { inputTokens: 5, outputTokens: 2 } }),
    ])

    const schema = z.object({ x: z.number() })

    const skill = defineSkill<void, { x: number }>({
      name: "structured-retry-skill",
      version: "1.0.0",
      async run(ctx) {
        return ctx.llmStructured(
          "strong",
          { messages: [{ role: "user", content: "give json" }] },
          schema,
        )
      },
    })

    const run = await runSkill({
      skill,
      input: undefined,
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
      retryOpts: { baseDelayMs: 1 },
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual({ x: 7 })
    expect(provider.calls).toHaveLength(2)

    const meter = new Meter(storage, NOW)
    const records = await meter.recordsForDay("2026-07-12")
    expect(records).toHaveLength(1)
  })
})
