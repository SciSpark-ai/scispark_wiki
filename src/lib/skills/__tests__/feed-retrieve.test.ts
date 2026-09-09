import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { logEvent } from "../../events/log"
import { buildPaperPage, composePage } from "../../wiki/authoring"
import type { PaperRecord } from "../../papers/types"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"
import { runSkill } from "../runner"
import {
  StrategySchema,
  feedStrategySkill,
  retrieveCandidates,
  vaultPaperKeys,
  type FeedStrategy,
  type SearchFn,
} from "../feed"

const NOW = () => new Date("2026-07-12T10:00:00.000Z")

const settingsWithKeys = (overrides?: Partial<LLMSettings>): LLMSettings => ({
  ...DEFAULT_SETTINGS,
  keys: { anthropic: "sk-test" },
  ...overrides,
})

function paper(overrides: Partial<PaperRecord> & { title: string }): PaperRecord {
  return {
    ids: {},
    authors: [],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// StrategySchema
// ---------------------------------------------------------------------------

describe("StrategySchema", () => {
  it("accepts a well-formed strategy with 1-8 queries", () => {
    const value = {
      queries: [{ source: "arxiv", query: "cat:cs.LG sparse attention", rationale: "core topic" }],
    }
    expect(StrategySchema.safeParse(value).success).toBe(true)
  })

  it("rejects zero queries", () => {
    expect(StrategySchema.safeParse({ queries: [] }).success).toBe(false)
  })

  it("rejects more than 8 queries", () => {
    const queries = Array.from({ length: 9 }, (_, i) => ({
      source: "arxiv",
      query: `q${i}`,
      rationale: "r",
    }))
    expect(StrategySchema.safeParse({ queries }).success).toBe(false)
  })

  it("rejects an unknown source", () => {
    const value = { queries: [{ source: "google-scholar", query: "x", rationale: "r" }] }
    expect(StrategySchema.safeParse(value).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// feedStrategySkill
// ---------------------------------------------------------------------------

describe("feedStrategySkill", () => {
  it("runs as a strong-tier structured call and returns a validated strategy", async () => {
    const storage = new MemoryVaultStorage()
    const output: FeedStrategy = {
      queries: [{ source: "openalex", query: "protein folding diffusion models", rationale: "core interest" }],
    }
    const result: LLMResult = {
      text: JSON.stringify(output),
      json: output,
      usage: { inputTokens: 400, outputTokens: 100 },
      model: "claude-opus-4-8",
      provider: "anthropic",
      stopReason: "end_turn",
    }
    const provider = new MockProvider([result])

    const run = await runSkill({
      skill: feedStrategySkill,
      input: { userContextText: "<<<PROFILE>>>\nPhD student.\n<<<END>>>" },
      storage,
      settings: settingsWithKeys(),
      providerOverride: { strong: provider },
      now: NOW,
    })

    expect(run.status).toBe("ok")
    expect(run.output).toEqual(output)
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].req.maxTokens).toBe(2048)
    expect(provider.calls[0].req.messages[0].role).toBe("system")
    expect(provider.calls[0].req.messages[1].content).toContain("PhD student")
    expect(provider.calls[0].req.messages[1].content).toMatch(/\/no_think\s*$/)
  })
})

// ---------------------------------------------------------------------------
// vaultPaperKeys
// ---------------------------------------------------------------------------

describe("vaultPaperKeys", () => {
  it("builds keys from paper-type pages' frontmatter ids, ignoring non-paper pages", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      "wiki/papers/foo.md",
      composePage({
        path: "wiki/papers/foo.md",
        frontmatter: {
          type: "paper",
          title: "Foo Paper",
          created: "2026-07-01",
          updated: "2026-07-01",
          tags: [],
          related: [],
          sources: [],
          doi: "10.1234/FOO",
        },
        body: "# Foo Paper\n",
      }),
    )
    await storage.write(
      "wiki/concepts/bar.md",
      composePage({
        path: "wiki/concepts/bar.md",
        frontmatter: {
          type: "concept",
          title: "Bar Concept",
          created: "2026-07-01",
          updated: "2026-07-01",
          tags: [],
          related: [],
          sources: [],
        },
        body: "# Bar Concept\n",
      }),
    )
    const { loadBundle } = await import("../../vault/bundle")
    const bundle = await loadBundle(storage)
    const keys = vaultPaperKeys(bundle)
    expect(keys.size).toBe(1)
    expect(keys.has("doi:10.1234/foo")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// retrieveCandidates
// ---------------------------------------------------------------------------

describe("retrieveCandidates", () => {
  it("threads opts.fromDate through to every searchFn call (SP2.1 freshness)", async () => {
    const storage = new MemoryVaultStorage()
    const strategy: FeedStrategy = {
      queries: [
        { source: "arxiv", query: "a", rationale: "r" },
        { source: "openalex", query: "b", rationale: "r" },
      ],
    }
    const seenOpts: Array<{ fromDate?: string } | undefined> = []
    const searchFn: SearchFn = async (_source, _query, _limit, opts) => {
      seenOpts.push(opts)
      return []
    }

    await retrieveCandidates(storage, strategy, searchFn, { fromDate: "2026-07-05" })

    expect(seenOpts).toHaveLength(2)
    for (const opts of seenOpts) {
      expect(opts?.fromDate).toBe("2026-07-05")
    }
  })

  const STRATEGY: FeedStrategy = {
    queries: [
      { source: "arxiv", query: "sparse attention", rationale: "core" },
      { source: "openalex", query: "sparse attention transformers", rationale: "adjacent" },
    ],
  }

  it("merges duplicate results across queries via mergeRecords (union of ids)", async () => {
    const storage = new MemoryVaultStorage()
    const searchFn: SearchFn = async (source) => {
      if (source === "arxiv") {
        return [paper({ title: "Shared Paper", ids: { arxiv: "2406.00001" }, abstract: "short" })]
      }
      return [
        paper({
          title: "Shared Paper",
          ids: { arxiv: "2406.00001", openalex: "W123" },
          abstract: "a much longer abstract than before",
        }),
      ]
    }

    const candidates = await retrieveCandidates(storage, STRATEGY, searchFn)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].ids).toEqual({ arxiv: "2406.00001", openalex: "W123" })
    expect(candidates[0].abstract).toBe("a much longer abstract than before")
  })

  it("a rejecting query contributes [] and doesn't lose other queries' results", async () => {
    const storage = new MemoryVaultStorage()
    const searchFn: SearchFn = async (source) => {
      if (source === "arxiv") throw new Error("upstream exploded")
      return [paper({ title: "Survivor", ids: { openalex: "W999" } })]
    }

    const candidates = await retrieveCandidates(storage, STRATEGY, searchFn)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].title).toBe("Survivor")
  })

  it("excludes a candidate already present as a vault paper page", async () => {
    const storage = new MemoryVaultStorage()
    // Build the page through the REAL production path (buildPaperPage), so this
    // test breaks if the frontmatter shape vaultPaperKeys reads ever drifts.
    const existing = paper({ title: "Existing Paper", ids: { doi: "10.5555/existing" } })
    const draft = buildPaperPage(existing, { today: "2026-07-01", fullText: false })
    await storage.write(draft.path, composePage(draft))
    const searchFn: SearchFn = async (source) => {
      if (source === "arxiv") return [paper({ title: "Existing Paper", ids: { doi: "10.5555/existing" } })]
      return [paper({ title: "New Paper", ids: { openalex: "W1" } })]
    }

    const candidates = await retrieveCandidates(storage, STRATEGY, searchFn)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].title).toBe("New Paper")
  })

  it("excludes a candidate matching a dismissed-event key from the last 200 events", async () => {
    const storage = new MemoryVaultStorage()
    const dismissed = paper({ title: "Dismissed Paper", ids: { arxiv: "2406.00002" } })
    await logEvent(storage, { type: "feed_dismiss", paperKey: "arxiv:2406.00002", title: "Dismissed Paper" }, NOW)

    const searchFn: SearchFn = async (source) => {
      if (source === "arxiv") return [dismissed]
      return [paper({ title: "Fresh Paper", ids: { openalex: "W2" } })]
    }

    const candidates = await retrieveCandidates(storage, STRATEGY, searchFn)

    expect(candidates.map((c) => c.title)).toEqual(["Fresh Paper"])
  })

  it("excludes a candidate matching a saved-event key", async () => {
    const storage = new MemoryVaultStorage()
    const saved = paper({ title: "Saved Paper", ids: { arxiv: "2406.00003" } })
    await logEvent(storage, { type: "feed_save", paperKey: "arxiv:2406.00003", title: "Saved Paper" }, NOW)

    const searchFn: SearchFn = async (source) => {
      if (source === "arxiv") return [saved]
      return []
    }

    const candidates = await retrieveCandidates(storage, STRATEGY, searchFn)

    expect(candidates).toEqual([])
  })

  it("preserves first-seen query order and respects the cap", async () => {
    const storage = new MemoryVaultStorage()
    const searchFn: SearchFn = async (source) => {
      if (source === "arxiv") {
        return [
          paper({ title: "A", ids: { arxiv: "1" } }),
          paper({ title: "B", ids: { arxiv: "2" } }),
        ]
      }
      return [
        paper({ title: "C", ids: { openalex: "3" } }),
        paper({ title: "D", ids: { openalex: "4" } }),
      ]
    }

    const all = await retrieveCandidates(storage, STRATEGY, searchFn)
    expect(all.map((c) => c.title)).toEqual(["A", "B", "C", "D"])

    const capped = await retrieveCandidates(storage, STRATEGY, searchFn, { cap: 2 })
    expect(capped.map((c) => c.title)).toEqual(["A", "B"])
  })

  it("passes perQueryLimit through to searchFn", async () => {
    const storage = new MemoryVaultStorage()
    const limits: number[] = []
    const searchFn: SearchFn = async (_source, _query, limit) => {
      limits.push(limit)
      return []
    }

    await retrieveCandidates(storage, STRATEGY, searchFn, { perQueryLimit: 7 })
    expect(limits).toEqual([7, 7])
  })
})
