import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { Frontmatter } from "../../vault/types"
import { serializeDocument } from "../../vault/frontmatter"
import { loadSession, saveSession, type ChatSession } from "../session"
import { askChat, MAX_HISTORY_TURNS } from "../orchestrator"

const NOW = () => new Date("2026-07-26T10:00:00.000Z")

const SETTINGS = {
  keys: { openai: "sk" },
  tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } },
  dailyBudgetUsd: 100,
  baseUrls: { openai: "https://x/v1" },
} as const

function structured(output: unknown): LLMResult {
  return {
    text: JSON.stringify(output),
    json: output,
    usage: { inputTokens: 10, outputTokens: 5 },
    model: "m",
    provider: "anthropic",
    stopReason: "end_turn",
  }
}

async function writePage(
  storage: MemoryVaultStorage,
  path: string,
  frontmatter: Partial<Frontmatter> & { type: string; title: string },
  body: string,
): Promise<void> {
  const full: Frontmatter = {
    created: "2026-07-01",
    updated: "2026-07-01",
    tags: [],
    related: [],
    sources: [],
    ...frontmatter,
  }
  await storage.write(path, serializeDocument(full, body))
}

/** A vault with one concept page and one saved paper page. */
async function seedVault(storage: MemoryVaultStorage): Promise<void> {
  await writePage(
    storage,
    "wiki/concepts/temporal-response-function.md",
    { type: "concept", title: "Temporal Response Function (TRF) Estimation", tags: ["trf", "eeg"] },
    "# Temporal Response Function (TRF) Estimation\n\nA TRF is a linear filter mapping a stimulus envelope onto neural response.",
  )
  await writePage(
    storage,
    "wiki/papers/ohara2024-decoding.md",
    {
      type: "paper",
      title: "Decoding attention from ear-EEG",
      tags: ["ear-eeg"],
      tldr: "Shows ear-EEG can decode auditory attention above chance.",
    },
    [
      "# Decoding attention from ear-EEG",
      "",
      "## Digest",
      "",
      "SYNTHESIS-ONLY-MARKER: the agent's own written digest of this paper.",
      "",
      "## Abstract",
      "",
      "ABSTRACT-MARKER: we recorded ear-EEG from 20 listeners during a competing-talkers task.",
      "",
      "## Links",
      "",
      "- DOI: [10.1/x](https://doi.org/10.1/x)",
    ].join("\n"),
  )
}

const CONCEPT_ID = "wiki/concepts/temporal-response-function"
const PAPER_ID = "wiki/papers/ohara2024-decoding"

/** Storage whose reads of one path throw from the second read onwards. */
class FlakyReadStorage extends MemoryVaultStorage {
  private reads = new Map<string, number>()
  constructor(private failPath: string) {
    super()
  }
  async read(path: string): Promise<string | null> {
    const count = (this.reads.get(path) ?? 0) + 1
    this.reads.set(path, count)
    if (path === this.failPath && count > 1) throw new Error("disk on fire")
    return super.read(path)
  }
}

function providers(fast: Array<LLMResult | Error>, strong: Array<LLMResult | Error>) {
  const fastProvider = new MockProvider(fast)
  const strongProvider = new MockProvider(strong)
  return { fastProvider, strongProvider, override: { fast: fastProvider, strong: strongProvider } }
}

function promptOf(provider: MockProvider, call = 0): string {
  return provider.calls[call].req.messages.map((m) => m.content).join("\n")
}

describe("askChat — happy path", () => {
  it("persists the user turn and the assistant answer with validated citations", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const { fastProvider, strongProvider, override } = providers(
      [structured({ pageIds: ["temporal-response-function"] })],
      [structured({ answer: "A TRF is a linear filter.", citedPageIds: [CONCEPT_ID] })],
    )

    const stages: string[] = []
    const result = await askChat(storage, {
      input: { sessionId: null, question: "What is a TRF?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
      onProgress: (stage) => stages.push(stage),
    })

    expect(stages).toEqual(["selecting", "answering"])
    expect(result.message.content).toBe("A TRF is a linear filter.")
    expect(result.message.citedPageIds).toEqual([CONCEPT_ID])
    expect(result.message.readSourcesOnly).toBe(false)
    expect(result.message.error).toBeUndefined()
    expect(result.message.selectionFallback).toBeUndefined()

    const session = await loadSession(storage, result.sessionId)
    expect(session?.title).toBe("What is a TRF?")
    expect(session?.messages).toHaveLength(2)
    expect(session?.messages[0]).toEqual({ role: "user", content: "What is a TRF?" })
    expect(session?.messages[1]).toEqual(result.message)

    // The selected page's body reached the answering call.
    expect(promptOf(strongProvider, 0)).toContain("linear filter mapping a stimulus envelope")
    expect(fastProvider.calls).toHaveLength(1)
    expect(strongProvider.calls).toHaveLength(1)
  })

  it("appends to an existing session rather than starting a new one", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const existing: ChatSession = {
      id: "chat_1",
      title: "Earlier question",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
      ],
    }
    await saveSession(storage, existing)
    const { override } = providers(
      [structured({ pageIds: [] })],
      [structured({ answer: "Second answer.", citedPageIds: [] })],
    )

    const result = await askChat(storage, {
      input: { sessionId: "chat_1", question: "And what about ear-EEG?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    expect(result.sessionId).toBe("chat_1")
    const session = await loadSession(storage, "chat_1")
    expect(session?.title).toBe("Earlier question")
    expect(session?.messages).toHaveLength(4)
    expect(session?.messages[2]).toEqual({ role: "user", content: "And what about ear-EEG?" })
    expect(session?.updatedAt).toBe(NOW().toISOString())
  })
})

describe("askChat — validation is the orchestrator's job", () => {
  it("drops a fabricated page id before context assembly", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const { strongProvider, override } = providers(
      [structured({ pageIds: ["wiki/concepts/ghost-page-that-does-not-exist", "temporal-response-function"] })],
      [structured({ answer: "A TRF is a linear filter.", citedPageIds: [CONCEPT_ID] })],
    )

    const result = await askChat(storage, {
      input: { sessionId: null, question: "What is a TRF?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    const prompt = promptOf(strongProvider, 0)
    expect(prompt).not.toContain("ghost-page-that-does-not-exist")
    expect(prompt).toContain(CONCEPT_ID)
    expect(result.message.citedPageIds).toEqual([CONCEPT_ID])
  })

  it("drops a citedPageId that was never in the supplied context", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const { override } = providers(
      [structured({ pageIds: ["temporal-response-function"] })],
      [
        structured({
          answer: "A TRF is a linear filter.",
          citedPageIds: [CONCEPT_ID, "wiki/concepts/invented-by-the-model"],
        }),
      ],
    )

    const result = await askChat(storage, {
      input: { sessionId: null, question: "What is a TRF?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    expect(result.message.citedPageIds).toEqual([CONCEPT_ID])
    const session = await loadSession(storage, result.sessionId)
    expect(session?.messages[1].citedPageIds).toEqual([CONCEPT_ID])
  })
})

describe("askChat — degradation ladder", () => {
  it("falls back to deterministic selection and flags it when the selection call fails", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const { strongProvider, override } = providers(
      [new Error("selection provider exploded")],
      [structured({ answer: "A TRF is a linear filter.", citedPageIds: [CONCEPT_ID] })],
    )

    const result = await askChat(storage, {
      input: {
        sessionId: null,
        question: "What is temporal response function estimation?",
        readSourcesOnly: false,
      },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    expect(result.message.selectionFallback).toBe(true)
    expect(result.message.error).toBeUndefined()
    expect(result.message.content).toBe("A TRF is a linear filter.")
    // The deterministic selector found the TRF page by term overlap.
    expect(promptOf(strongProvider, 0)).toContain("linear filter mapping a stimulus envelope")
  })

  it("skips a selected page that fails to read and answers from the rest", async () => {
    // Fails only on the SECOND read of the paper page: the first read is
    // `loadBundle`'s (so the page is a real, selectable candidate), the second
    // is the orchestrator's own context read — the failure this path exists for.
    const storage = new FlakyReadStorage(`${PAPER_ID}.md`)
    await seedVault(storage)

    const { strongProvider, override } = providers(
      [structured({ pageIds: ["temporal-response-function", "ohara2024-decoding"] })],
      [structured({ answer: "A TRF is a linear filter.", citedPageIds: [CONCEPT_ID] })],
    )

    const result = await askChat(storage, {
      input: { sessionId: null, question: "What is a TRF?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    const prompt = promptOf(strongProvider, 0)
    expect(prompt).toContain("linear filter mapping a stimulus envelope")
    expect(prompt).not.toContain("ABSTRACT-MARKER")
    expect(result.message.content).toBe("A TRF is a linear filter.")
    expect(result.message.skippedPageIds).toEqual([PAPER_ID])
  })

  it("persists an assistant message carrying the real error, keeping the user turn, when answering fails", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const { override } = providers(
      [structured({ pageIds: ["temporal-response-function"] })],
      [new Error("answer provider exploded")],
    )

    const result = await askChat(storage, {
      input: { sessionId: null, question: "What is a TRF?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    expect(result.message.error).toContain("answer provider exploded")
    expect(result.message.citedPageIds).toEqual([])

    const session = await loadSession(storage, result.sessionId)
    expect(session?.messages).toHaveLength(2)
    expect(session?.messages[0]).toEqual({ role: "user", content: "What is a TRF?" })
    expect(session?.messages[1].error).toContain("answer provider exploded")
  })

  it("degrades to an error message, keeping the user turn, when the vault itself cannot be read", async () => {
    class UnlistableStorage extends MemoryVaultStorage {
      async list(prefix = ""): Promise<string[]> {
        if (prefix === "wiki/") throw new Error("vault unreadable")
        return super.list(prefix)
      }
    }
    const storage = new UnlistableStorage()
    const { fastProvider, strongProvider, override } = providers([], [])

    const result = await askChat(storage, {
      input: { sessionId: null, question: "What is a TRF?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    expect(result.message.error).toContain("vault unreadable")
    expect(fastProvider.calls).toHaveLength(0)
    expect(strongProvider.calls).toHaveLength(0)
    const session = await loadSession(storage, result.sessionId)
    expect(session?.messages[0]).toEqual({ role: "user", content: "What is a TRF?" })
    expect(session?.messages).toHaveLength(2)
  })

  it("answers an empty vault without calling the LLM at all", async () => {
    const storage = new MemoryVaultStorage()
    const { fastProvider, strongProvider, override } = providers([], [])

    const result = await askChat(storage, {
      input: { sessionId: null, question: "What do I know about TRFs?", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    expect(fastProvider.calls).toHaveLength(0)
    expect(strongProvider.calls).toHaveLength(0)
    expect(result.message.content).toContain("/papers")
    expect(result.message.citedPageIds).toEqual([])

    const session = await loadSession(storage, result.sessionId)
    expect(session?.messages).toHaveLength(2)
    expect(session?.messages[1].content).toContain("/papers")
  })

  it("treats a vault with no paper pages as empty when Read Sources Only is on", async () => {
    const storage = new MemoryVaultStorage()
    await writePage(
      storage,
      "wiki/concepts/temporal-response-function.md",
      { type: "concept", title: "Temporal Response Function (TRF) Estimation" },
      "# TRF\n\nA linear filter.",
    )
    const { fastProvider, strongProvider, override } = providers([], [])

    const result = await askChat(storage, {
      input: { sessionId: null, question: "What is a TRF?", readSourcesOnly: true },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    expect(fastProvider.calls).toHaveLength(0)
    expect(strongProvider.calls).toHaveLength(0)
    expect(result.message.content).toContain("/papers")
    expect(result.message.readSourcesOnly).toBe(true)
  })
})

describe("askChat — candidate scoping and context shape", () => {
  it("narrows the index to paper pages when Read Sources Only is on", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const { fastProvider, strongProvider, override } = providers(
      [structured({ pageIds: ["ohara2024-decoding"] })],
      [structured({ answer: "Ear-EEG decodes attention.", citedPageIds: [PAPER_ID] })],
    )

    await askChat(storage, {
      input: { sessionId: null, question: "Which paper covers ear-EEG?", readSourcesOnly: true },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    const indexPrompt = promptOf(fastProvider, 0)
    expect(indexPrompt).toContain("ohara2024-decoding")
    expect(indexPrompt).not.toContain("temporal-response-function")

    // Paper context is the TL;DR + abstract, never the agent's digest synthesis.
    const answerPrompt = promptOf(strongProvider, 0)
    expect(answerPrompt).toContain("ABSTRACT-MARKER")
    expect(answerPrompt).toContain("Shows ear-EEG can decode auditory attention above chance.")
    expect(answerPrompt).not.toContain("SYNTHESIS-ONLY-MARKER")
  })

  it("sends only the last MAX_HISTORY_TURNS turns, and not the current question, as history", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn-${String(i + 1).padStart(2, "0")}`,
    }))
    await saveSession(storage, {
      id: "chat_1",
      title: "Long chat",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages,
    })
    const { fastProvider, strongProvider, override } = providers(
      [structured({ pageIds: [] })],
      [structured({ answer: "ok", citedPageIds: [] })],
    )

    await askChat(storage, {
      input: { sessionId: "chat_1", question: "latest question", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: override,
      now: NOW,
    })

    for (const prompt of [promptOf(fastProvider, 0), promptOf(strongProvider, 0)]) {
      expect(prompt).not.toContain("turn-04")
      expect(prompt).toContain("turn-05")
      expect(prompt).toContain("turn-10")
      // The current question travels in its own field, not in the history block.
      expect(prompt.match(/latest question/g) ?? []).toHaveLength(1)
    }
    expect(MAX_HISTORY_TURNS).toBe(6)
  })
})

describe("askChat — session id minting", () => {
  it("never overwrites an existing session when two are minted from the same instant", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)

    const first = await askChat(storage, {
      input: { sessionId: null, question: "First question", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: providers(
        [structured({ pageIds: [] })],
        [structured({ answer: "one", citedPageIds: [] })],
      ).override,
      now: NOW,
    })
    const second = await askChat(storage, {
      input: { sessionId: null, question: "Second question", readSourcesOnly: false },
      settings: SETTINGS,
      providerOverride: providers(
        [structured({ pageIds: [] })],
        [structured({ answer: "two", citedPageIds: [] })],
      ).override,
      now: NOW,
    })

    expect(second.sessionId).not.toBe(first.sessionId)
    const one = await loadSession(storage, first.sessionId)
    const two = await loadSession(storage, second.sessionId)
    expect(one?.messages[0].content).toBe("First question")
    expect(two?.messages[0].content).toBe("Second question")
  })

  it("gives concurrent new sessions distinct ids", async () => {
    const storage = new MemoryVaultStorage()
    await seedVault(storage)
    const ask = (question: string) =>
      askChat(storage, {
        input: { sessionId: null, question, readSourcesOnly: false },
        settings: SETTINGS,
        providerOverride: providers(
          [structured({ pageIds: [] })],
          [structured({ answer: "ok", citedPageIds: [] })],
        ).override,
        now: NOW,
      })

    const [a, b, c] = await Promise.all([ask("Q one"), ask("Q two"), ask("Q three")])
    expect(new Set([a.sessionId, b.sessionId, c.sessionId]).size).toBe(3)
    for (const r of [a, b, c]) {
      expect((await loadSession(storage, r.sessionId))?.messages).toHaveLength(2)
    }
  })
})
