import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import { runSkill } from "../runner"
import { EnrichSchema, enrichSkill, type EnrichResult } from "../enrich"

const NOW = () => new Date("2026-07-16T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG for Auditory Attention Decoding",
  abstract: "We study a low-profile ear-EEG system for decoding auditory attention.",
  authors: [{ name: "A. Researcher" }],
  year: 2024,
  venue: "arXiv",
  fields: ["eess.SP"],
  source: "arxiv",
}

const WIKI_INDEX = [
  { id: "concepts/auditory-attention", title: "Auditory Attention", type: "concept" },
  { id: "methods/ear-eeg", title: "Ear-EEG", type: "method" },
]

function structuredResult(value: EnrichResult): LLMResult {
  return {
    text: JSON.stringify(value),
    json: value,
    usage: { inputTokens: 120, outputTokens: 40 },
    model: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

describe("EnrichSchema", () => {
  it("accepts a well-formed enrich result", () => {
    const value = {
      tldr: "This paper proposes a low-profile ear-EEG system for decoding auditory attention.",
      tags: ["ear-eeg", "auditory attention"],
      relatedPageIds: ["concepts/auditory-attention"],
    }
    expect(EnrichSchema.safeParse(value).success).toBe(true)
  })

  it("rejects a result missing tldr", () => {
    const value = {
      tags: ["ear-eeg"],
      relatedPageIds: [],
    }
    expect(EnrichSchema.safeParse(value).success).toBe(false)
  })
})

describe("enrichSkill", () => {
  it("returns the parsed tldr/tags/relatedPageIds from a fast-tier structured call", async () => {
    const storage = new MemoryVaultStorage()
    const canned: EnrichResult = {
      tldr: "This paper proposes a low-profile ear-EEG system for decoding auditory attention.",
      tags: ["ear-eeg", "auditory attention", "deep learning"],
      relatedPageIds: ["concepts/auditory-attention", "methods/ear-eeg"],
    }
    const provider = new MockProvider([structuredResult(canned)])

    const run = await runSkill({
      skill: enrichSkill,
      input: { paper: PAPER, wikiIndex: WIKI_INDEX },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(canned)
  })

  it("runs on the FAST tier with a tight token budget", async () => {
    const storage = new MemoryVaultStorage()
    const canned: EnrichResult = {
      tldr: "A paper about ear-EEG.",
      tags: ["ear-eeg"],
      relatedPageIds: [],
    }
    const provider = new MockProvider([structuredResult(canned)])

    await runSkill({
      skill: enrichSkill,
      input: { paper: PAPER, wikiIndex: WIKI_INDEX },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].model).toBe(settingsWithKeys().tierModels.fast.model)
    expect(provider.calls[0].req.maxTokens).toBe(512)
  })

  it("fences the paper metadata and wiki index as untrusted data", async () => {
    const storage = new MemoryVaultStorage()
    const canned: EnrichResult = {
      tldr: "A paper about ear-EEG.",
      tags: ["ear-eeg"],
      relatedPageIds: [],
    }
    const provider = new MockProvider([structuredResult(canned)])

    await runSkill({
      skill: enrichSkill,
      input: { paper: PAPER, wikiIndex: WIKI_INDEX },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { fast: provider },
      now: NOW,
    })

    const userMsg = provider.calls[0].req.messages.find((m) => m.role === "user")?.content ?? ""
    expect(userMsg).toContain("<<<PAPER>>>")
    expect(userMsg).toContain("<<<END-PAPER>>>")
    expect(userMsg).toContain("<<<INDEX>>>")
    expect(userMsg).toContain("<<<END-INDEX>>>")
    expect(userMsg).toContain(PAPER.title)
    expect(userMsg).toContain("concepts/auditory-attention")
  })
})
