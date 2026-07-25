import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { SearchFn } from "../../skills/feed"
import type { GroupEntry } from "../../papers/openalex"
import type { TopicGroupFn } from "../../papers/node-search"
import { readRecentEvents } from "../../events/log"
import {
  runTrendingBoard,
  loadBoard,
  isStale,
  anchorsMatchBoard,
  DASHBOARD_CACHE_PATH,
  TRENDING_BOARD_VERSION,
} from "../dashboard"
import type { TrendingBoard } from "../dashboard"
import { completeWindows } from "../topics"
import { isoWeekStart } from "../weeks"
import { loadTrendingSettings, saveTrendingSettings } from "../settings"
import type { CountFn, GroupFn } from "../weekly-volume"

const NOW = () => new Date("2026-07-14T00:00:00.000Z")
const WINDOWS = completeWindows(NOW())

function paper(o: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "arxiv", ...o }
}
function structured(output: unknown): LLMResult {
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 100, outputTokens: 50 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
const SETTINGS = { keys: { openai: "sk" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://x/v1" } } as const

const NEURO = { id: "https://openalex.org/fields/28", label: "Neuroscience" }
const CS = { id: "https://openalex.org/fields/17", label: "Computer Science" }

/** Group entries keyed by discipline label, split by which window is asked for. */
type GroupSpec = Record<string, { recent: GroupEntry[]; prior: GroupEntry[] }>

function topicGroupFnFor(spec: GroupSpec): TopicGroupFn {
  return async ({ query, fromDate }) => {
    const entry = spec[query]
    if (!entry) return []
    return fromDate === WINDOWS.recent.fromDate ? entry.recent : entry.prior
  }
}

/** Every label rolls up to Neuroscience — the derivation happy path. */
const fieldGroupFn: TopicGroupFn = async () => [{ ...NEURO, key: NEURO.id, count: 500 }]

const ONE_DISCIPLINE: GroupSpec = {
  Neuroscience: {
    recent: [
      { key: "T1", label: "Auditory Attention Decoding", count: 40 },
      { key: "T2", label: "Speech Processing", count: 20 },
      { key: "T3", label: "Below The Floor", count: 2 },
    ],
    prior: [
      { key: "T1", label: "Auditory Attention Decoding", count: 10 },
      { key: "T2", label: "Speech Processing", count: 20 },
    ],
  },
}

const BRIEFS_ONE = {
  topics: [
    { key: "T1", why: "because attention decoding got cheap" },
    { key: "T2", why: "because speech models got good" },
  ],
  crossDisciplineNote: "both ride the same representation-learning wave",
}

const searchFn: SearchFn = async (_source, query) => [
  paper({ title: `Rep paper for ${query}`, date: "2026-07-10", year: 2026, citationCount: 9, venue: "ACL" }),
]

/** Deterministic per-week counts so the sparkline assertions are exact. */
const countFn: CountFn = async () => 4
const groupFn: GroupFn = async () => []

function baseOpts(over: Partial<Parameters<typeof runTrendingBoard>[1]> = {}) {
  return {
    fields: [{ slug: "auditory-attention", label: "auditory attention decoding" }],
    searchFn,
    topicGroupFn: topicGroupFnFor(ONE_DISCIPLINE),
    fieldGroupFn,
    countFn,
    groupFn,
    settings: SETTINGS,
    now: NOW,
    ...over,
  }
}

async function seedAnchors(storage: MemoryVaultStorage, anchors: Array<{ id: string; label: string }>) {
  await saveTrendingSettings(storage, {
    fields: [{ slug: "auditory-attention", label: "auditory attention decoding" }],
    cadence: "weekly",
    anchors,
    anchorsOverridden: false,
  })
}

describe("runTrendingBoard", () => {
  it("produces a ranked, versioned board with sparklines, papers and whys, persists it, and logs an event", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])

    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))

    expect(board.version).toBe(TRENDING_BOARD_VERSION)
    expect(board.anchors).toEqual([NEURO])
    // T3 is under MIN_RECENT_COUNT; T1 (+300%) outranks T2 (0%).
    expect(board.topics.map((t) => t.key)).toEqual(["T1", "T2"])
    expect(board.topics[0].label).toBe("Auditory Attention Decoding")
    expect(board.topics[0].discipline).toBe("Neuroscience")
    expect(board.topics[0].growth).toBeCloseTo(3)
    expect(board.topics[0].recentCount).toBe(40)
    expect(board.topics[0].weekly.length).toBe(8)
    expect(board.topics[0].weekly.every((v) => v.count === 4)).toBe(true)
    expect(board.overview.totalRecent).toBe(4) // real count call, not the bucket sum
    expect(board.topics[0].papers.map((p) => p.record.title)).toEqual(["Rep paper for Auditory Attention Decoding"])
    expect(board.topics[0].papers[0].wikiPageId).toBeNull()
    expect(board.topics[0].why).toBe("because attention decoding got cheap")
    expect(board.topics[1].why).toBe("because speech models got good")
    expect(board.crossDisciplineNote).toBe(BRIEFS_ONE.crossDisciplineNote)
    expect(board.surveyError).toBeUndefined()
    expect(board.breakouts.length).toBeGreaterThan(0)
    expect(board.breakouts[0].citationCount).toBe(9)

    const raw = await storage.read(DASHBOARD_CACHE_PATH)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).version).toBe(TRENDING_BOARD_VERSION)
    const loaded = await loadBoard(storage)
    expect(loaded?.topics.map((t) => t.key)).toEqual(["T1", "T2"])

    const events = await readRecentEvents(storage)
    expect(events.some((e) => e.type === "trending_refresh")).toBe(true)
  })

  it("anchors the sparkline to the last COMPLETE week, never the in-progress one", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))

    const weekly = board.topics[0].weekly
    // NOW() is Tue 2026-07-14; its ISO week starts Mon 2026-07-13 (in progress,
    // systematically low). The recent window ends Sun 2026-07-12, whose week
    // starts Mon 2026-07-06 — that must be the newest bucket, or every
    // sparkline dips while its growth badge (complete weeks only) rises.
    expect(weekly[weekly.length - 1].weekStart).toBe("2026-07-06")
    expect(weekly.some((v) => v.weekStart === isoWeekStart(NOW()))).toBe(false)
  })

  it("never sends any number to the LLM (no counts, growth or dates in the prompt)", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))

    const prompt = provider.calls[0].req.messages.map((m) => m.content).join("\n")
    expect(prompt).not.toContain("40") // recentCount
    expect(prompt).not.toContain("300") // growth
    expect(prompt).not.toContain(WINDOWS.recent.fromDate)
    expect(prompt).toContain("Auditory Attention Decoding")
  })

  it("joins briefs to topics by key verbatim — an unmatched brief key leaves that topic's why null", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([
      structured({ topics: [{ key: "t1", why: "wrong case key" }, { key: "T2", why: "ok" }], crossDisciplineNote: "n" }),
    ])
    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))
    expect(board.topics.find((t) => t.key === "T1")?.why).toBeNull()
    expect(board.topics.find((t) => t.key === "T2")?.why).toBe("ok")
  })

  it("a topic-group failure for one discipline drops its topics but keeps the other discipline's", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO, CS])
    const spec: GroupSpec = {
      ...ONE_DISCIPLINE,
      // Computer Science throws on every window request.
    }
    const topicGroupFn: TopicGroupFn = async (q) => {
      if (q.query === "Computer Science") throw new Error("openalex 500")
      return topicGroupFnFor(spec)(q)
    }
    // Only the surviving discipline runs a skill call.
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(storage, baseOpts({ topicGroupFn, providerOverride: { strong: provider } }))

    expect(board.topics.map((t) => t.key)).toEqual(["T1", "T2"])
    expect(board.topics.every((t) => t.discipline === "Neuroscience")).toBe(true)
    expect(provider.calls).toHaveLength(1)
  })

  it("a weekly-series failure yields weekly: [] with the row still present", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const failingCount: CountFn = async () => {
      throw new Error("openalex down")
    }
    const board = await runTrendingBoard(
      storage,
      baseOpts({ countFn: failingCount, providerOverride: { strong: provider } }),
    )
    expect(board.topics.map((t) => t.key)).toEqual(["T1", "T2"])
    expect(board.topics[0].weekly).toEqual([])
    expect(board.topics[0].growth).toBeCloseTo(3) // numbers untouched by the series failure
  })

  it("a representative-paper search failure yields papers: [] with the row still present", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const failingSearch: SearchFn = async () => {
      throw new Error("search exploded")
    }
    const board = await runTrendingBoard(
      storage,
      baseOpts({ searchFn: failingSearch, providerOverride: { strong: provider } }),
    )
    expect(board.topics.map((t) => t.key)).toEqual(["T1", "T2"])
    expect(board.topics[0].papers).toEqual([])
    expect(board.breakouts).toEqual([])
  })

  it("a skill failure leaves every why null, records the real reason in surveyError, and still persists the board", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([new Error("llm exploded")])
    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))

    expect(board.topics).toHaveLength(2)
    expect(board.topics.every((t) => t.why === null)).toBe(true)
    expect(board.surveyError).toBeTruthy()
    expect(board.surveyError).toContain("llm exploded")
    expect(board.crossDisciplineNote).toBeNull()
    // Numbers survive the LLM failure.
    expect(board.topics[0].recentCount).toBe(40)
    const persisted = await loadBoard(storage)
    expect(persisted?.topics.every((t) => t.why === null)).toBe(true)
    expect(persisted?.surveyError).toBeTruthy()
    expect(persisted?.generatedAt).toBe(board.generatedAt)
  })

  it("meters a failed survey: the trending_refresh event still carries the spend", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    // A PRICED model, so the run's cost is a real non-zero number rather than
    // pricing.ts's null for an unknown id.
    const pricedSettings = {
      ...SETTINGS,
      tierModels: {
        fast: { provider: "openai", model: "claude-sonnet-5" },
        strong: { provider: "openai", model: "claude-sonnet-5" },
      },
    } as const
    // Well-formed responses that FAIL the schema (`topics` must be non-empty):
    // completeStructured burns both attempts, then throws a
    // StructuredOutputError carrying the summed usage. Those tokens were really
    // spent, so they must reach the refresh event — a survey that fails while
    // silently billing was a real production bug (M10 failure honesty).
    const invalid = { topics: [], crossDisciplineNote: "x" }
    const provider = new MockProvider([structured(invalid), structured(invalid)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ settings: pricedSettings, providerOverride: { strong: provider } }),
    )

    expect(board.surveyError).toBeTruthy()
    expect(board.topics.every((t) => t.why === null)).toBe(true)
    const events = await readRecentEvents(storage)
    const refresh = events.find((e) => e.type === "trending_refresh") as { costUsd?: number } | undefined
    expect(refresh).toBeTruthy()
    expect(refresh!.costUsd).toBeGreaterThan(0)
  })

  it("derives anchors when none are stored and persists them to trending settings", async () => {
    const storage = new MemoryVaultStorage()
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))
    expect(board.anchors).toEqual([NEURO])
    expect((await loadTrendingSettings(storage)).anchors).toEqual([NEURO])
    expect(board.topics.map((t) => t.key)).toEqual(["T1", "T2"])
  })

  it("does not re-derive anchors the user has overridden", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, {
      fields: [{ slug: "auditory-attention", label: "auditory attention decoding" }],
      cadence: "weekly",
      anchors: [CS],
      anchorsOverridden: true,
    })
    const derivationMustNotRun: TopicGroupFn = async () => {
      throw new Error("fieldGroupFn must not be called for overridden anchors")
    }
    const provider = new MockProvider([structured({ topics: [{ key: "T1", why: "w" }], crossDisciplineNote: "n" })])
    const board = await runTrendingBoard(
      storage,
      baseOpts({
        fieldGroupFn: derivationMustNotRun,
        topicGroupFn: topicGroupFnFor({ "Computer Science": ONE_DISCIPLINE.Neuroscience }),
        providerOverride: { strong: provider },
      }),
    )
    expect(board.anchors).toEqual([CS])
  })

  it("does not re-derive a stored, non-overridden anchor list either", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [CS]) // anchorsOverridden: false
    const derivationMustNotRun: TopicGroupFn = async () => {
      throw new Error("fieldGroupFn must not be called when anchors are already stored")
    }
    const provider = new MockProvider([structured({ topics: [{ key: "T1", why: "w" }], crossDisciplineNote: "n" })])
    const board = await runTrendingBoard(
      storage,
      baseOpts({
        fieldGroupFn: derivationMustNotRun,
        topicGroupFn: topicGroupFnFor({ "Computer Science": ONE_DISCIPLINE.Neuroscience }),
        providerOverride: { strong: provider },
      }),
    )
    // deriveAnchorDisciplines swallows per-label throws, so a re-derivation
    // would silently produce the narrow-label fallback instead of [CS].
    expect(board.anchors).toEqual([CS])
  })

  it("re-derives when the user removed the last anchor chip (empty list, override flag still set)", async () => {
    const storage = new MemoryVaultStorage()
    // Exactly the state the settings editor leaves behind when the last chip is
    // removed. Honoring the flag here would silently scope the board by the
    // narrow interest labels — the scoping SP4 exists to replace.
    await saveTrendingSettings(storage, {
      fields: [{ slug: "auditory-attention", label: "auditory attention decoding" }],
      cadence: "weekly",
      anchors: [],
      anchorsOverridden: true,
    })
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))
    expect(board.anchors).toEqual([NEURO])
    const settings = await loadTrendingSettings(storage)
    expect(settings.anchors).toEqual([NEURO])
    expect(settings.anchorsOverridden).toBe(true) // a re-derivation never un-sets the user's intent
  })

  it("persisting derived anchors does not revert a settings edit made during derivation", async () => {
    const storage = new MemoryVaultStorage()
    const fields = [{ slug: "auditory-attention", label: "auditory attention decoding" }]
    await saveTrendingSettings(storage, { fields, cadence: "weekly", anchors: [], anchorsOverridden: false })
    const editDuringDerivation: TopicGroupFn = async (q) => {
      // The user flips cadence in settings while the (slow, networked)
      // derivation is in flight. A snapshot-then-overwrite would revert it.
      await saveTrendingSettings(storage, { fields, cadence: "daily", anchors: [], anchorsOverridden: false })
      return fieldGroupFn(q)
    }
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    await runTrendingBoard(storage, baseOpts({ fieldGroupFn: editDuringDerivation, providerOverride: { strong: provider } }))

    const settings = await loadTrendingSettings(storage)
    expect(settings.cadence).toBe("daily")
    expect(settings.anchors).toEqual([NEURO])
  })

  it("falls back to the narrow field labels as anchors when derivation fails", async () => {
    const storage = new MemoryVaultStorage()
    const failingFieldGroup: TopicGroupFn = async () => {
      throw new Error("openalex 429")
    }
    const provider = new MockProvider([structured({ topics: [{ key: "T1", why: "w" }], crossDisciplineNote: "n" })])
    const board = await runTrendingBoard(
      storage,
      baseOpts({
        fieldGroupFn: failingFieldGroup,
        topicGroupFn: topicGroupFnFor({ "auditory attention decoding": ONE_DISCIPLINE.Neuroscience }),
        providerOverride: { strong: provider },
      }),
    )
    expect(board.anchors).toEqual([{ id: "auditory-attention", label: "auditory attention decoding" }])
    expect(board.topics.map((t) => t.key)).toEqual(["T1", "T2"])
    // A fallback scope is not a user-visible derivation result — nothing persisted.
    expect((await loadTrendingSettings(storage)).anchors).toEqual([])
  })

  it("overview figures come from the underlying deterministic data (real counts, top-ranked topic)", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    // A real recent-window count that is deliberately LARGER than the group
    // buckets sum to (40+20+2=62): group_by caps at 200 groups, so the bucket
    // sum silently truncates the long tail — the overview must not use it.
    const bigCount: CountFn = async () => 5000
    const board = await runTrendingBoard(
      storage,
      baseOpts({ countFn: bigCount, providerOverride: { strong: provider } }),
    )
    expect(board.overview.totalRecent).toBe(5000)
    expect(board.overview.topTopicLabel).toBe("Auditory Attention Decoding")
    expect(board.overview.topTopicGrowth).toBeCloseTo(3)
    expect(board.overview.relevantCount).toBe(board.topics.filter((t) => t.relevant).length)
  })

  it("overview totalRecent sums one real count per anchor discipline", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO, CS])
    const spec: GroupSpec = { ...ONE_DISCIPLINE, "Computer Science": ONE_DISCIPLINE.Neuroscience }
    const perAnchor: CountFn = async ({ query }) => (query === "Neuroscience" ? 1000 : 300)
    const provider = new MockProvider([structured(BRIEFS_ONE), structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ topicGroupFn: topicGroupFnFor(spec), countFn: perAnchor, providerOverride: { strong: provider } }),
    )
    expect(board.overview.totalRecent).toBe(1300)
  })

  it("overview totalRecent falls back to the group buckets when the count call fails", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const failingCount: CountFn = async () => {
      throw new Error("openalex down")
    }
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ countFn: failingCount, providerOverride: { strong: provider } }),
    )
    expect(board.overview.totalRecent).toBe(62) // 40 + 20 + 2: low but honest, never blank
  })

  it("breakouts are RECENT papers only — an all-old sample yields an empty strip", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    // A heavily-cited field classic from years ago: `movers` ranks it first,
    // but it is not recent, so it must not headline "what's breaking out now".
    const oldSearchFn: SearchFn = async (_source, query) => [
      paper({ title: `Classic on ${query}`, date: "2019-01-01", year: 2019, citationCount: 9000 }),
    ]
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ searchFn: oldSearchFn, providerOverride: { strong: provider } }),
    )
    expect(board.breakouts).toEqual([])
    expect(board.topics.length).toBeGreaterThan(0) // the rest of the board is unaffected
  })

  it("marks topics the user's interest labels touch (the lens) without any per-row count", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))
    // "auditory attention decoding" shares tokens with "Auditory Attention Decoding".
    expect(board.topics.find((t) => t.key === "T1")?.relevant).toBe(true)
    expect(board.topics.find((t) => t.key === "T2")?.relevant).toBe(false)
    expect(board.overview.relevantCount).toBe(1)
  })

  it("links a representative paper to its existing wiki page (a link, never a count)", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    await storage.write(
      "wiki/papers/rep-paper-for-auditory-attention-decoding.md",
      [
        "---",
        "type: paper",
        "title: Rep paper for Auditory Attention Decoding",
        "created: 2026-07-01",
        "updated: 2026-07-01",
        "tags: []",
        "related: []",
        "sources: []",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    )
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(storage, baseOpts({ providerOverride: { strong: provider } }))
    const topic = board.topics.find((t) => t.key === "T1")!
    expect(topic.papers[0].wikiPageId).toBe("wiki/papers/rep-paper-for-auditory-attention-decoding")
    expect(board.breakouts[0].wikiPageId).toBeNull() // different title → no page, no decoration
  })

  it("a malformed wiki page cannot blank the board (the lens degrades to not-relevant)", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    // A numeric tag: the frontmatter contract only checks that `tags` is an
    // array, so this reaches the lens's tokenizer as a number and throws there.
    await storage.write(
      "wiki/concepts/broken.md",
      ["---", "type: concept", "title: Broken", "created: 2026-07-01", "updated: 2026-07-01", "tags:", "  - 42", "related: []", "sources: []", "---", "", "body", ""].join("\n"),
    )
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ fields: [{ slug: "unrelated", label: "quantum chromodynamics" }], providerOverride: { strong: provider } }),
    )
    expect(board.topics.map((t) => t.key)).toEqual(["T1", "T2"])
    expect(board.topics.every((t) => t.relevant === false)).toBe(true)
  })

  it("concurrent calls for the same storage share one in-flight run (no double-spend)", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const opts = baseOpts({ providerOverride: { strong: provider } })
    const [a, b] = await Promise.all([runTrendingBoard(storage, opts), runTrendingBoard(storage, opts)])
    expect(provider.calls).toHaveLength(1)
    expect(a).toBe(b)
    const events = await readRecentEvents(storage)
    expect(events.filter((e) => e.type === "trending_refresh")).toHaveLength(1)
  })

  it("a call AFTER the shared run settles starts a fresh run", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE), structured(BRIEFS_ONE)])
    const opts = baseOpts({ providerOverride: { strong: provider } })
    await runTrendingBoard(storage, opts)
    expect(provider.calls).toHaveLength(1)
    await runTrendingBoard(storage, opts)
    expect(provider.calls).toHaveLength(2)
    const events = await readRecentEvents(storage)
    expect(events.filter((e) => e.type === "trending_refresh")).toHaveLength(2)
  })

  it("different storage instances do not share an in-flight run", async () => {
    const storageA = new MemoryVaultStorage()
    const storageB = new MemoryVaultStorage()
    await seedAnchors(storageA, [NEURO])
    await seedAnchors(storageB, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE), structured(BRIEFS_ONE)])
    const opts = baseOpts({ providerOverride: { strong: provider } })
    await Promise.all([runTrendingBoard(storageA, opts), runTrendingBoard(storageB, opts)])
    expect(provider.calls).toHaveLength(2)
  })

  it("reports progress per anchor discipline", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO, CS])
    const provider = new MockProvider([structured(BRIEFS_ONE), structured(BRIEFS_ONE)])
    const seen: string[] = []
    await runTrendingBoard(
      storage,
      baseOpts({ providerOverride: { strong: provider }, onProgress: (d: string) => seen.push(d) }),
    )
    expect(seen).toContain("Neuroscience")
    expect(seen).toContain("Computer Science")
  })
})

describe("loadBoard", () => {
  it("returns null when nothing is cached", async () => {
    expect(await loadBoard(new MemoryVaultStorage())).toBeNull()
  })

  it("returns null (cold start, never a crash) for an old v1 dashboard.json", async () => {
    const storage = new MemoryVaultStorage()
    // The real M10/v1.1 shape, which has no `version` at all.
    await storage.write(
      DASHBOARD_CACHE_PATH,
      JSON.stringify({
        panels: [{ field: { slug: "nlp", label: "NLP" }, metrics: {}, survey: null, generatedAt: "2026-07-13T00:00:00.000Z" }],
        generatedAt: "2026-07-13T00:00:00.000Z",
      }),
    )
    expect(await loadBoard(storage)).toBeNull()
  })

  it("returns null for a cache written with an explicit older version", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify({ version: 1, topics: [], generatedAt: NOW().toISOString() }))
    expect(await loadBoard(storage)).toBeNull()
  })

  it("returns null for malformed JSON", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(DASHBOARD_CACHE_PATH, "{not json at all")
    expect(await loadBoard(storage)).toBeNull()
  })

  it("returns null for a current-version cache missing its topics array", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      DASHBOARD_CACHE_PATH,
      JSON.stringify({ version: TRENDING_BOARD_VERSION, generatedAt: NOW().toISOString() }),
    )
    expect(await loadBoard(storage)).toBeNull()
  })
})

function board(over: Partial<TrendingBoard> = {}): TrendingBoard {
  return {
    version: TRENDING_BOARD_VERSION,
    anchors: [],
    overview: { totalRecent: 0, topTopicLabel: null, topTopicGrowth: null, relevantCount: 0 },
    topics: [],
    breakouts: [],
    crossDisciplineNote: null,
    generatedAt: NOW().toISOString(),
    ...over,
  }
}

describe("isStale", () => {
  it("null board is always stale", () => {
    expect(isStale(null, "weekly", NOW())).toBe(true)
  })
  it("weekly: stale after 7 days, fresh before", () => {
    expect(isStale(board({ generatedAt: "2026-07-10T00:00:00.000Z" }), "weekly", NOW())).toBe(false)
    expect(isStale(board({ generatedAt: "2026-07-01T00:00:00.000Z" }), "weekly", NOW())).toBe(true)
  })
  it("daily: stale after 1 day", () => {
    expect(isStale(board({ generatedAt: "2026-07-12T00:00:00.000Z" }), "daily", NOW())).toBe(true)
  })
  it("weekly: exactly 7*24h old is stale (boundary is inclusive)", () => {
    expect(isStale(board({ generatedAt: "2026-07-07T00:00:00.000Z" }), "weekly", NOW())).toBe(true)
  })
  it("weekly: 7 days minus 1ms old is still fresh (just inside the window)", () => {
    expect(isStale(board({ generatedAt: "2026-07-07T00:00:00.001Z" }), "weekly", NOW())).toBe(false)
  })
  it("daily: exactly 24h old is stale (boundary is inclusive)", () => {
    expect(isStale(board({ generatedAt: "2026-07-13T00:00:00.000Z" }), "daily", NOW())).toBe(true)
  })
  it("an unparseable generatedAt is stale", () => {
    expect(isStale(board({ generatedAt: "not a date" }), "weekly", NOW())).toBe(true)
  })
})

describe("anchorsMatchBoard", () => {
  it("true when the anchor id sets match exactly", () => {
    expect(anchorsMatchBoard(board({ anchors: [NEURO, CS] }), [CS, NEURO])).toBe(true)
  })
  it("false when an anchor was added", () => {
    expect(anchorsMatchBoard(board({ anchors: [NEURO] }), [NEURO, CS])).toBe(false)
  })
  it("false when an anchor was removed", () => {
    expect(anchorsMatchBoard(board({ anchors: [NEURO, CS] }), [NEURO])).toBe(false)
  })
  it("false when the sets are disjoint", () => {
    expect(anchorsMatchBoard(board({ anchors: [NEURO] }), [CS])).toBe(false)
  })
  it("false for a null board", () => {
    expect(anchorsMatchBoard(null, [NEURO])).toBe(false)
  })
  it("true for an empty-vs-empty comparison (nothing derived yet on either side)", () => {
    expect(anchorsMatchBoard(board({ anchors: [] }), [])).toBe(true)
  })
})
