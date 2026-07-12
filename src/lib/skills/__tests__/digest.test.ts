import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import { Meter } from "../../llm/metering"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import { paperSlug } from "../../wiki/authoring"
import { DigestSchema, generateDigest } from "../digest"

const NOW = () => new Date("2026-07-12T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const PAPER: PaperRecord = {
  ids: { arxiv: "2406.01234" },
  title: "Attention Is All You Need Again",
  abstract: "We revisit the transformer architecture and propose a new variant.",
  authors: [{ name: "Ada Lovelace" }, { name: "Alan Turing" }],
  year: 2024,
  venue: "NeurIPS",
  fields: ["Machine Learning"],
  source: "arxiv",
}

const SAMPLE_DIGEST = {
  summary: "This paper introduces a new transformer variant with improved efficiency.",
  laySummary: "The authors made AI models faster without losing accuracy. This could make AI tools cheaper to run.",
  keyPoints: [
    "Proposes a sparse attention mechanism",
    "Reduces training time by 30%",
    "Matches baseline accuracy on standard benchmarks",
  ],
  methods: "The authors trained models on standard benchmarks and compared wall-clock training time.",
  limitations: "Evaluated only on English-language text; larger-scale generalization is untested.",
  fieldContext: "Sits within the broader line of work on efficient transformer architectures.",
}

function structuredResult(overrides?: Partial<LLMResult>): LLMResult {
  return {
    text: JSON.stringify(SAMPLE_DIGEST),
    json: SAMPLE_DIGEST,
    usage: { inputTokens: 500, outputTokens: 200 },
    model: "claude-opus-4-8",
    provider: "anthropic",
    stopReason: "end_turn",
    ...overrides,
  }
}

describe("DigestSchema", () => {
  it("parses a well-formed digest", () => {
    expect(DigestSchema.safeParse(SAMPLE_DIGEST).success).toBe(true)
  })

  it("rejects a digest missing required fields", () => {
    const rest: Partial<typeof SAMPLE_DIGEST> = { ...SAMPLE_DIGEST }
    delete rest.summary
    expect(DigestSchema.safeParse(rest).success).toBe(false)
  })
})

describe("generateDigest", () => {
  it("happy path: calls the LLM, returns the digest, and writes a valid cache file", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult()])

    const result = await generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(result.fromCache).toBe(false)
    expect(result.digest).toEqual(SAMPLE_DIGEST)
    expect(result.runId).toBeDefined()
    expect(result.costUsd).toBeGreaterThan(0)
    expect(provider.calls).toHaveLength(1)

    const cachePath = `.scispark/digests/${paperSlug(PAPER)}.json`
    const cached = await storage.read(cachePath)
    expect(cached).not.toBeNull()
    expect(JSON.parse(cached as string)).toEqual(SAMPLE_DIGEST)

    const meter = new Meter(storage, NOW)
    const records = await meter.recordsForDay("2026-07-12")
    expect(records).toHaveLength(1)
    expect(records[0].skill).toBe("digest")
  })

  it("second call hits the cache: returns cached digest with zero provider calls", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult()])

    const first = await generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })
    expect(first.fromCache).toBe(false)
    expect(provider.calls).toHaveLength(1)

    const second = await generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(second.fromCache).toBe(true)
    expect(second.digest).toEqual(SAMPLE_DIGEST)
    expect(second.runId).toBeUndefined()
    // No new provider call was made for the cache hit.
    expect(provider.calls).toHaveLength(1)
  })

  it("corrupt cache JSON is regenerated: provider is called and the cache file is overwritten", async () => {
    const storage = new MemoryVaultStorage()
    const cachePath = `.scispark/digests/${paperSlug(PAPER)}.json`
    await storage.write(cachePath, "{not valid json::")

    const provider = new MockProvider([structuredResult()])

    const result = await generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(result.fromCache).toBe(false)
    expect(provider.calls).toHaveLength(1)

    const cached = await storage.read(cachePath)
    expect(JSON.parse(cached as string)).toEqual(SAMPLE_DIGEST)
  })

  it("cache file failing schema validation (invalid shape) is regenerated rather than trusted", async () => {
    const storage = new MemoryVaultStorage()
    const cachePath = `.scispark/digests/${paperSlug(PAPER)}.json`
    await storage.write(cachePath, JSON.stringify({ summary: "only a summary, missing everything else" }))

    const provider = new MockProvider([structuredResult()])

    const result = await generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(result.fromCache).toBe(false)
    expect(provider.calls).toHaveLength(1)
    expect(result.digest).toEqual(SAMPLE_DIGEST)
  })

  it("budget_exceeded run throws an Error whose message contains 'budget'", async () => {
    const storage = new MemoryVaultStorage()
    const meter = new Meter(storage, NOW)
    await meter.record({
      skill: "other-skill",
      runId: "run-prior",
      provider: "anthropic",
      model: "claude-opus-4-8",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    })

    const provider = new MockProvider([structuredResult()])

    await expect(
      generateDigest(storage, PAPER, {
        settings: settingsWithKeys({ dailyBudgetUsd: 0.000001 }),
        providerOverride: { strong: provider },
        now: NOW,
      }),
    ).rejects.toThrow(/budget/i)

    expect(provider.calls).toHaveLength(0)
  })

  it("prompt includes the paper title, and notes truncation when full text exceeds 40,000 characters", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult()])
    const longFullText = "x".repeat(45_000)

    await generateDigest(storage, PAPER, {
      fullText: longFullText,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    const { messages } = provider.calls[0].req
    const allContent = messages.map((m) => m.content).join("\n")

    expect(allContent).toContain(PAPER.title)
    expect(allContent.toLowerCase()).toContain("truncat")

    // The full-text portion of the prompt is capped at 40,000 chars, not the full 45,000.
    const fullTextMessage = messages.find((m) => m.content.includes("x".repeat(100)))
    expect(fullTextMessage).toBeDefined()
    const xRunLength = (fullTextMessage!.content.match(/x+/)?.[0] ?? "").length
    expect(xRunLength).toBeLessThanOrEqual(40_000)
  })

  it("prompt with short full text does not mention truncation", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult()])

    await generateDigest(storage, PAPER, {
      fullText: "a short excerpt of the paper",
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const { messages } = provider.calls[0].req
    const allContent = messages.map((m) => m.content).join("\n")
    expect(allContent.toLowerCase()).not.toContain("truncat")
  })
})
