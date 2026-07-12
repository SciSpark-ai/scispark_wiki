import { describe, it, expect } from "vitest"
import { z } from "zod"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { Meter } from "../../llm/metering"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import { LLMAuthError, type LLMResult } from "../../llm/types"
import { MockProvider } from "../../llm/mock-provider"
import { defineSkill } from "../types"
import { runSkill } from "../runner"

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
})
