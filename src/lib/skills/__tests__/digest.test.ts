import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import { Meter } from "../../llm/metering"
import type { LLMResult, LLMProvider, LLMRequest } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
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

  it("truncation with no whitespace near the boundary falls back to a hard cut at exactly 40,000 characters", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult()])
    // No whitespace anywhere, so there's nothing to cut back to — must hard-cut at the limit.
    const longFullText = "x".repeat(45_000)

    await generateDigest(storage, PAPER, {
      fullText: longFullText,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const { messages } = provider.calls[0].req
    const fullTextMessage = messages.find((m) => m.content.includes("x".repeat(100)))
    expect(fullTextMessage).toBeDefined()
    // Longest run of "x" (the label text itself contains a lone "x" in the word "text").
    const xRunLength = Math.max(0, ...[...fullTextMessage!.content.matchAll(/x+/g)].map((m) => m[0].length))
    expect(xRunLength).toBe(40_000)
  })

  it("truncation cuts at the last whitespace before the boundary, not mid-word", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structuredResult()])
    // A space sits just inside the final-200-chars search window before the 40,000 limit,
    // followed by a run of "z"s that would otherwise get cut mid-word by a raw slice(0, 40000).
    const longFullText = "a".repeat(39_990) + " " + "z".repeat(100)

    await generateDigest(storage, PAPER, {
      fullText: longFullText,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    const { messages } = provider.calls[0].req
    const fullTextMessage = messages.find((m) => m.content.includes("a".repeat(100)))
    expect(fullTextMessage).toBeDefined()
    // The trailing "z" word was cut entirely — none of it should leak into the prompt.
    expect(fullTextMessage!.content).not.toContain("z")
    // Longest run of "a" (other prose in the prompt — "Ada Lovelace", "a longer document" — has short "a" runs too).
    const aRunLength = Math.max(0, ...[...fullTextMessage!.content.matchAll(/a+/g)].map((m) => m[0].length))
    expect(aRunLength).toBe(39_990)
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

  it("cache write failure: digest is still returned with cacheWriteFailed: true", async () => {
    // A storage wrapper that throws only for digest cache paths
    class FailingDigestStorage implements VaultStorage {
      constructor(private delegate: MemoryVaultStorage) {}
      async read(path: string): Promise<string | null> {
        return this.delegate.read(path)
      }
      async write(path: string, content: string): Promise<void> {
        if (path.includes(".scispark/digests/")) {
          throw new Error("Storage quota exceeded for digests")
        }
        return this.delegate.write(path, content)
      }
      async readBinary(path: string): Promise<Uint8Array | null> {
        return this.delegate.readBinary(path)
      }
      async writeBinary(path: string, data: Uint8Array): Promise<void> {
        return this.delegate.writeBinary(path, data)
      }
      async delete(path: string): Promise<void> {
        return this.delegate.delete(path)
      }
      async list(prefix = ""): Promise<string[]> {
        return this.delegate.list(prefix)
      }
    }

    const delegate = new MemoryVaultStorage()
    const storage = new FailingDigestStorage(delegate)
    const provider = new MockProvider([structuredResult()])

    const result = await generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    // Despite cache write failure, the digest is returned with the flag set
    expect(result.digest).toEqual(SAMPLE_DIGEST)
    expect(result.fromCache).toBe(false)
    expect(result.cacheWriteFailed).toBe(true)
    expect(result.runId).toBeDefined()
    expect(result.costUsd).toBeGreaterThan(0)
    expect(provider.calls).toHaveLength(1)

    // Cache file was not written (attempt failed)
    const cachePath = `.scispark/digests/${paperSlug(PAPER)}.json`
    const cached = await delegate.read(cachePath)
    expect(cached).toBeNull()
  })

  it("concurrent calls for the same paper share a single provider call (single-flight)", async () => {
    // A storage wrapper that delays the read operation to ensure concurrency
    class SlowReadStorage implements VaultStorage {
      constructor(private delegate: MemoryVaultStorage, private delayMs = 100) {}
      async read(path: string): Promise<string | null> {
        // Delay the read to allow the second call to arrive while the first is pending
        if (path.includes(".scispark/digests")) {
          await new Promise((resolve) => setTimeout(resolve, this.delayMs))
        }
        return this.delegate.read(path)
      }
      async write(path: string, content: string): Promise<void> {
        return this.delegate.write(path, content)
      }
      async readBinary(path: string): Promise<Uint8Array | null> {
        return this.delegate.readBinary(path)
      }
      async writeBinary(path: string, data: Uint8Array): Promise<void> {
        return this.delegate.writeBinary(path, data)
      }
      async delete(path: string): Promise<void> {
        return this.delegate.delete(path)
      }
      async list(prefix = ""): Promise<string[]> {
        return this.delegate.list(prefix)
      }
    }

    // A deferred mock provider that only responds after a signal
    class DeferredMockProvider implements LLMProvider {
      readonly id = "anthropic" as const
      calls: Array<{ model: string; req: LLMRequest }> = []
      private resolveNext: ((result: LLMResult) => void) | null = null
      private deferred: Promise<LLMResult> | null = null

      async complete(model: string, req: LLMRequest): Promise<LLMResult> {
        this.calls.push({ model, req })
        // For the first call, create a deferred promise that waits for resolution
        if (!this.deferred) {
          this.deferred = new Promise((resolve) => {
            this.resolveNext = resolve
          })
        }
        return this.deferred
      }

      resolve(result: LLMResult): void {
        if (this.resolveNext) {
          this.resolveNext(result)
        }
      }
    }

    const delegate = new MemoryVaultStorage()
    const storage = new SlowReadStorage(delegate, 20)
    const provider = new DeferredMockProvider()

    // Start two concurrent generateDigest calls for the same paper.
    // The first call will start, check the map, create a promise, and start the IIFE.
    // Before the storage.read completes, the second call will start, check the map,
    // and find the first call's promise already there.
    const call1Promise = generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    // Immediately start the second call (before the first call's storage.read completes)
    const call2Promise = generateDigest(storage, PAPER, {
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    // Give the first call time to complete its storage.read and reach the provider call.
    // Storage delay is 20ms, so wait a bit longer to ensure runSkill has been called.
    await new Promise((resolve) => setTimeout(resolve, 100))

    // At this point, only one provider call should have been made (the first one).
    // The second call should be awaiting the same in-flight promise.
    expect(provider.calls).toHaveLength(1)

    // Resolve the deferred provider
    provider.resolve(structuredResult())

    // Both concurrent calls should resolve with the same digest
    const result1 = await call1Promise
    const result2 = await call2Promise

    expect(result1.digest).toEqual(SAMPLE_DIGEST)
    expect(result2.digest).toEqual(SAMPLE_DIGEST)
    // Both should have the same runId since they shared the single flight
    expect(result1.runId).toBe(result2.runId)
    // Still only one provider call total
    expect(provider.calls).toHaveLength(1)
  })
})
