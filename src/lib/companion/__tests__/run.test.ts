import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { seedUserModel } from "../../usermodel/pages"
import { saveCompanionSettings } from "../settings"
import type { TriggerState } from "../triggers"
import { runCompanion, type RunCompanionArgs } from "../run"

const NOW = () => new Date("2026-07-13T12:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const ANSWERS = {
  name: "Ada",
  role: "PhD student in computational biology",
  fields: "computational biology",
  topics: "protein folding",
  feedPrefs: "methods papers",
}

async function seededStorage(): Promise<MemoryVaultStorage> {
  const storage = new MemoryVaultStorage()
  await seedUserModel(storage, ANSWERS, NOW)
  return storage
}

const SAMPLE_UTTERANCE = { utterance: "A possible duplicate needs your review." }

function structuredResult(overrides?: Partial<LLMResult>): LLMResult {
  return {
    text: JSON.stringify(SAMPLE_UTTERANCE),
    json: SAMPLE_UTTERANCE,
    usage: { inputTokens: 100, outputTokens: 20 },
    model: "claude-opus-4-8",
    provider: "anthropic",
    stopReason: "end_turn",
    ...overrides,
  }
}

// A concrete, fresh review item with a live destination.
const REVIEW_STATE: Omit<TriggerState, "nowMs"> = {
  route: "/",
  hasFeedCache: true,
  recentEvents: [],
  reviewCount: 1,
  reviews: [{ id: "rev-1", createdAt: NOW().toISOString(), title: "Possible duplicate" }],
  bundle: null,
  lastShownTs: {},
}

// A TriggerState (minus nowMs) that makes nothing fire.
const NO_TRIGGER_STATE: Omit<TriggerState, "nowMs"> = {
  route: "/wiki",
  hasFeedCache: false,
  recentEvents: [],
  reviewCount: 0,
  bundle: null,
  lastShownTs: {},
}

async function readEventsThisMonth(storage: MemoryVaultStorage): Promise<Array<Record<string, unknown>>> {
  const raw = await storage.read(".scispark/events/2026-07.jsonl")
  if (raw === null) return []
  return raw
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l))
}

function baseArgs(storage: MemoryVaultStorage, overrides?: Partial<RunCompanionArgs>): RunCompanionArgs {
  return {
    storage,
    state: REVIEW_STATE,
    sessionShownCount: 0,
    settings: settingsWithKeys(),
    now: NOW,
    ...overrides,
  }
}

describe("runCompanion", () => {
  it("chattiness off: returns null, makes no LLM call, logs nothing", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "off", companionName: "Ember" })
    const provider = new MockProvider([structuredResult()])

    const result = await runCompanion(baseArgs(storage, { providerOverride: { fast: provider } }))

    expect(result).toBeNull()
    expect(provider.calls).toHaveLength(0)
    expect(await readEventsThisMonth(storage)).toHaveLength(0)
  })

  it("session budget exhausted: returns null, makes no LLM call", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "low", companionName: "Ember" }) // SESSION_BUDGET.low = 2
    const provider = new MockProvider([structuredResult()])

    const result = await runCompanion(
      baseArgs(storage, { sessionShownCount: 2, providerOverride: { fast: provider } }),
    )

    expect(result).toBeNull()
    expect(provider.calls).toHaveLength(0)
    expect(await readEventsThisMonth(storage)).toHaveLength(0)
  })

  it("no trigger fires: returns null, nothing logged, no LLM call", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "medium", companionName: "Ember" })
    const provider = new MockProvider([structuredResult()])

    const result = await runCompanion(
      baseArgs(storage, { state: NO_TRIGGER_STATE, providerOverride: { fast: provider } }),
    )

    expect(result).toBeNull()
    expect(provider.calls).toHaveLength(0)
    expect(await readEventsThisMonth(storage)).toHaveLength(0)
  })

  it("firing trigger under budget: returns utterance from the skill, logs companion_shown, attaches action", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "medium", companionName: "Ember" })
    const provider = new MockProvider([structuredResult()])

    const result = await runCompanion(baseArgs(storage, { providerOverride: { fast: provider } }))

    expect(result).not.toBeNull()
    expect(result!.trigger).toBe("review-pending")
    expect(result!.text).toBe(SAMPLE_UTTERANCE.utterance)
    expect(result!.fromTemplate).toBe(false)
    expect(result!.costUsd).toBeGreaterThan(0)
    expect(result!.action).toEqual({ label: "Review inbox", href: "/wiki/inbox" })
    expect(provider.calls).toHaveLength(1)

    const events = await readEventsThisMonth(storage)
    const shown = events.filter((e) => e.type === "companion_shown")
    expect(shown).toHaveLength(1)
    expect(shown[0].trigger).toBe("review-pending")
  })

  it("passes triggerContext and feedback.md body to the skill", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "medium", companionName: "Ember" })
    const provider = new MockProvider([structuredResult()])

    await runCompanion(baseArgs(storage, { providerOverride: { fast: provider } }))

    const userMessage = provider.calls[0].req.messages[1].content
    expect(userMessage).toContain("Possible duplicate")
    expect(userMessage).toContain("Standing instructions")
  })

  it("forced provider error: falls back to the template utterance, still logs shown, never throws", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "medium", companionName: "Ember" })
    const provider = new MockProvider([new Error("provider exploded")])

    const result = await runCompanion(baseArgs(storage, { providerOverride: { fast: provider } }))

    expect(result).not.toBeNull()
    expect(result!.trigger).toBe("review-pending")
    expect(result!.fromTemplate).toBe(true)
    expect(result!.costUsd).toBe(0)
    expect(result!.text).toBe("An item needs your review: Possible duplicate")
    expect(result!.action).toEqual({ label: "Review inbox", href: "/wiki/inbox" })

    const events = await readEventsThisMonth(storage)
    const shown = events.filter((e) => e.type === "companion_shown")
    expect(shown).toHaveLength(1)
  })

  it("companionName in settings: the companionSkill's system prompt carries the custom name (M7 addendum)", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "medium", companionName: "Fizz" })
    const provider = new MockProvider([structuredResult()])

    const result = await runCompanion(baseArgs(storage, { providerOverride: { fast: provider } }))

    expect(result).not.toBeNull()
    expect(provider.calls).toHaveLength(1)
    const systemContent = provider.calls[0].req.messages[0].content
    expect(systemContent).toContain("Fizz")
    expect(systemContent).not.toContain("Ember")
  })

  it("unexpected error anywhere in the flow never throws — returns null", async () => {
    const storage = await seededStorage()
    await saveCompanionSettings(storage, { chattiness: "medium", companionName: "Ember" })
    // Force an unexpected failure: storage.read throws for any path.
    const brokenStorage = {
      ...storage,
      read: async () => {
        throw new Error("disk on fire")
      },
    } as unknown as MemoryVaultStorage

    const result = await runCompanion(baseArgs(brokenStorage))

    expect(result).toBeNull()
  })
})
