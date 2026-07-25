import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import type { PaperRecord } from "../../papers/types"
import type { GroupEntry } from "../../papers/openalex"
import type { TopicGroupFn, TopWorksFn } from "../../papers/node-search"
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
import { loadTrendingSettings, saveTrendingSettings } from "../settings"
import type { CountFn } from "../counts"

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

/**
 * Per-discipline RECENT buckets plus the TRUE prior counts a filtered count
 * request would return for each topic key. The prior side is deliberately NOT
 * a GroupEntry[] any more: prior counts are looked up, never grouped (SP4 §3).
 */
type GroupSpec = Record<string, { recent: GroupEntry[]; prior: Record<string, number> }>

function topicGroupFnFor(spec: GroupSpec): TopicGroupFn {
  return async ({ query, fromDate }) => {
    const entry = spec[query]
    if (!entry) return []
    // Only the recent window is ever grouped; anything else is a bug.
    return fromDate === WINDOWS.recent.fromDate ? entry.recent : []
  }
}

/**
 * A CountFn standing in for OpenAlex: a prior-window request carrying a
 * `topicId` answers from the spec's prior map; everything else is an
 * anchor-wide CORPUS total (one per window per discipline — the share
 * denominators) and returns `other`, or `priorTotal` for the prior window.
 *
 * The two default to the SAME size, so growth-by-share reduces to
 * growth-by-raw-count and the ranking assertions below stay readable. The
 * corpus-shrinkage cases pass a smaller recent total explicitly.
 */
function countFnFor(spec: GroupSpec, other = 4, priorTotal = other): CountFn {
  return async ({ query, fromDate, toDate, topicId }) => {
    if (isPriorLookup({ fromDate, toDate, topicId })) {
      const prior = spec[query]?.prior ?? {}
      return prior[topicId!] ?? 0
    }
    return fromDate === WINDOWS.prior.fromDate ? priorTotal : other
  }
}

/** True for an anchor-wide corpus count (no topicId) over the PRIOR window. */
function isPriorCorpusTotal(q: { fromDate: string; topicId?: string }): boolean {
  return q.topicId === undefined && q.fromDate === WINDOWS.prior.fromDate
}

/**
 * A prior-count lookup spans the WHOLE prior window and names a topic. Both
 * halves are still asserted even though the board no longer issues any OTHER
 * topic-scoped count: a test that stopped distinguishing them would go green
 * against a reintroduced per-topic series.
 */
function isPriorLookup(q: { fromDate: string; toDate: string; topicId?: string }): boolean {
  return q.topicId !== undefined && q.fromDate === WINDOWS.prior.fromDate && q.toDate === WINDOWS.prior.toDate
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
    prior: { T1: 10, T2: 20 },
  },
}

const BRIEFS_ONE = {
  topics: [
    { key: "T1", why: "because attention decoding got cheap" },
    { key: "T2", why: "because speech models got good" },
  ],
  crossDisciplineNote: "both ride the same representation-learning wave",
}

/**
 * One work in the fake OpenAlex corpus, carrying the entity ids OpenAlex would
 * classify it under. `topicId`/`fieldId` are the paper's IDENTITY; its title is
 * just prose, exactly as in the real API.
 */
interface FakeWork {
  record: PaperRecord
  topicId?: string
  fieldId?: string
}

/**
 * A fake `searchTopCitedWorks`: filters the corpus by the requested entity ids
 * and date window, then ranks most-cited first.
 *
 * `query` is honoured with LOOSE token matching (any shared word), modelling
 * OpenAlex free-text search — which is precisely how an off-topic paper reaches
 * a row whose label happens to use common words. A stub that ignored `query`
 * would silently pass a regression back to name-based fetching.
 */
function topWorksFnFor(corpus: FakeWork[]): TopWorksFn {
  return async (q) =>
    corpus
      .filter((w) => (q.topicId === undefined || w.topicId === q.topicId))
      .filter((w) => (q.fieldId === undefined || w.fieldId === q.fieldId))
      .filter((w) => (q.query === undefined || sharesToken(w.record.title ?? "", q.query)))
      .filter((w) => inWindow(w.record.date, q.fromDate, q.toDate))
      .map((w) => w.record)
      .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
      .slice(0, q.limit ?? 25)
}

function sharesToken(title: string, query: string): boolean {
  const words = new Set(title.toLowerCase().split(/\W+/).filter(Boolean))
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean)
    .some((w) => words.has(w))
}

function inWindow(date: string | undefined, fromDate: string, toDate: string): boolean {
  return date !== undefined && date >= fromDate && date <= toDate
}

/** `date` (YYYY-MM-DD) shifted back by whole days. */
function daysBefore(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The default corpus: one paper per leaderboard topic inside the recent window,
 * plus a heavier-cited Neuroscience paper carrying NO leaderboard topic — it is
 * reachable only through the field-scoped breakout request, so it proves the
 * two retrieval scopes are wired separately.
 */
const REP_T1 = paper({ title: "Attention decoding at scale", date: WINDOWS.recent.fromDate, year: 2026, citationCount: 4, venue: "ACL" })
const REP_T2 = paper({ title: "Speech processing survey", date: WINDOWS.recent.fromDate, year: 2026, citationCount: 2, venue: "Interspeech" })
// Breakout-strip papers: inside the 90-day window, in the anchor's field, and
// matching its label as text (the strip is scoped by BOTH). Neither carries a
// leaderboard topic, so they are reachable only through the breakout request.
const BREAKOUT = paper({ title: "Cortical mapping in neuroscience", date: daysBefore(WINDOWS.recent.toDate, 40), year: 2026, citationCount: 9 })
const BREAKOUT_2 = paper({ title: "Neuroscience methods roundup", date: daysBefore(WINDOWS.recent.toDate, 10), year: 2026, citationCount: 5 })

const CORPUS: FakeWork[] = [
  { topicId: "T1", fieldId: NEURO.id, record: REP_T1 },
  { topicId: "T2", fieldId: NEURO.id, record: REP_T2 },
  { topicId: "T99", fieldId: NEURO.id, record: BREAKOUT },
  { topicId: "T98", fieldId: NEURO.id, record: BREAKOUT_2 },
]

const topWorksFn = topWorksFnFor(CORPUS)

/** Deterministic per-week counts (and prior lookups) so assertions stay exact. */
const countFn: CountFn = countFnFor(ONE_DISCIPLINE)

function baseOpts(over: Partial<Parameters<typeof runTrendingBoard>[1]> = {}) {
  return {
    fields: [{ slug: "auditory-attention", label: "auditory attention decoding" }],
    topWorksFn,
    topicGroupFn: topicGroupFnFor(ONE_DISCIPLINE),
    fieldGroupFn,
    countFn,
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
  it("produces a ranked, versioned board with before/after counts, papers and whys, persists it, and logs an event", async () => {
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
    expect(board.topics[0].priorCount).toBe(10) // the looked-up prior, carried onto the board for the bars
    expect(board.overview.totalRecent).toBe(4) // real count call, not the bucket sum
    expect(board.topics[0].papers.map((p) => p.record.title)).toEqual(["Attention decoding at scale"])
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

  it("REGRESSION: a topic invisible in the prior window's grouped list gets a real growth figure, not \"new\"", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [CS])
    // The live shape of the bug (Computer Science, 2026-07-25): OpenAlex caps
    // group_by at 200 buckets and the prior window's threshold is HIGHER (22)
    // than the recent one's (14), so this topic appears in the recent list and
    // vanishes from the prior one. The old two-list join called that priorCount
    // 0 → growth null → "new" → first place, for 60 of 200 topics.
    const spec: GroupSpec = {
      "Computer Science": {
        recent: [
          { key: "T10689", label: "Remote-Sensing Image Classification", count: 27 },
          { key: "T0", label: "Genuinely New Topic", count: 12 },
        ],
        prior: { T10689: 16, T0: 0 }, // the true, looked-up counts
      },
    }
    const provider = new MockProvider([structured({ topics: [], crossDisciplineNote: null })])
    const board = await runTrendingBoard(
      storage,
      baseOpts({
        topicGroupFn: topicGroupFnFor(spec),
        countFn: countFnFor(spec),
        providerOverride: { strong: provider },
      }),
    )

    const remote = board.topics.find((t) => t.key === "T10689")!
    expect(remote.growth).not.toBeNull()
    expect(remote.growth).toBeCloseTo(0.6875) // 16 → 27, a real +69%
    // A genuine zero prior is still "new" — and now that is the ONLY thing
    // "new" means, so it legitimately outranks the +69% row.
    expect(board.topics.find((t) => t.key === "T0")!.growth).toBeNull()
    expect(board.topics.map((t) => t.key)).toEqual(["T0", "T10689"])
  })

  it("issues NO per-topic series requests — every topic-scoped count is a prior lookup", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const seen: Array<{ query: string; fromDate: string; toDate: string; topicId?: string }> = []
    const spyCount: CountFn = async (q) => {
      seen.push({ query: q.query, fromDate: q.fromDate, toDate: q.toDate, topicId: q.topicId })
      return countFn(q)
    }
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    await runTrendingBoard(storage, baseOpts({ countFn: spyCount, providerOverride: { strong: provider } }))

    // The bars are drawn from the shares already in hand, so the ONLY
    // topic-scoped requests are the prior lookups (one per candidate over the
    // whole prior window). An 8-week sparkline would have cost 8 more requests
    // per topic here — that cost, and the chart-vs-badge mismatch it caused
    // when the series was scoped differently, is what this replaces.
    const topicScoped = seen.filter((s) => s.topicId !== undefined)
    expect(topicScoped.length).toBe(2) // T1 and T2 (T3 is under the floor)
    expect(topicScoped.every((s) => isPriorLookup(s))).toBe(true)
    expect(topicScoped.every((s) => s.query === "Neuroscience")).toBe(true)
    expect(new Set(topicScoped.map((s) => s.topicId))).toEqual(new Set(["T1", "T2"]))
    // Plus exactly TWO anchor-wide corpus totals — this discipline's size in
    // each window, the share denominators. Nothing else.
    const corpusTotals = seen.filter((s) => s.topicId === undefined)
    expect(corpusTotals).toHaveLength(2)
    expect(corpusTotals.every((s) => s.query === "Neuroscience")).toBe(true)
    expect(new Set(corpusTotals.map((s) => s.fromDate))).toEqual(
      new Set([WINDOWS.recent.fromDate, WINDOWS.prior.fromDate]),
    )
  })

  it("groups only the RECENT window — the prior window is never grouped", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const windowsAsked: string[] = []
    const spyGroup: TopicGroupFn = async (q) => {
      windowsAsked.push(q.fromDate)
      return topicGroupFnFor(ONE_DISCIPLINE)(q)
    }
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    await runTrendingBoard(storage, baseOpts({ topicGroupFn: spyGroup, providerOverride: { strong: provider } }))
    expect(windowsAsked).toEqual([WINDOWS.recent.fromDate])
  })

  it("carries the exact SHARES growth was computed from, so a row's bars can never contradict its badge", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    // Deliberately unequal corpus sizes, so a row whose bars were drawn from
    // raw counts would visibly disagree with its share-based badge.
    const shrinking = countFnFor(ONE_DISCIPLINE, 400, 800)
    const board = await runTrendingBoard(
      storage,
      baseOpts({ countFn: shrinking, providerOverride: { strong: provider } }),
    )

    for (const t of board.topics) {
      expect(Number.isFinite(t.priorCount)).toBe(true)
      expect(t.recentShare).toBeCloseTo(t.recentCount / 400, 10)
      if (t.priorCount === 0) {
        expect(t.growth).toBeNull()
        expect(t.priorShare).toBe(0)
      } else {
        expect(t.priorShare).toBeCloseTo(t.priorCount / 800, 10)
        expect(t.growth).toBeCloseTo((t.recentShare - t.priorShare) / t.priorShare, 10)
      }
    }
    expect(board.topics.map((t) => [t.priorCount, t.recentCount])).toEqual([
      [10, 40],
      [20, 20],
    ])
  })

  it("HEADLINE: a shrinking corpus cannot fake a decline — a topic losing raw papers but gaining share ranks positive", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [CS])
    // Tonight's real Computer Science windows: prior 22808 → recent 13953,
    // i.e. the recent fortnight is only ~61% indexed. "Multimodal Machine
    // Learning" went 184 → 134 (−27% raw, +19% by share) and "Complexity and
    // Algorithms in Graphs" 39 → 60 (+54% raw, +151% by share). Ranked on raw
    // counts, 8 of 10 live rows came back negative on a page about what is
    // heating up.
    const spec: GroupSpec = {
      "Computer Science": {
        recent: [
          { key: "mml", label: "Multimodal Machine Learning", count: 134 },
          { key: "graphs", label: "Complexity and Algorithms in Graphs", count: 60 },
        ],
        prior: { mml: 184, graphs: 39 },
      },
    }
    const provider = new MockProvider([structured({ topics: [], crossDisciplineNote: null })])
    const board = await runTrendingBoard(
      storage,
      baseOpts({
        topicGroupFn: topicGroupFnFor(spec),
        countFn: countFnFor(spec, 13953, 22808),
        providerOverride: { strong: provider },
      }),
    )

    const mml = board.topics.find((t) => t.key === "mml")!
    expect(mml.recentCount).toBeLessThan(mml.priorCount) // raw volume really did fall
    expect(mml.growth).toBeGreaterThan(0) // ...and the badge says "heating up"
    expect(mml.growth).toBeCloseTo(0.19, 2)
    expect(board.topics.find((t) => t.key === "graphs")!.growth).toBeCloseTo(1.5147, 3)
    // ...and the bars are drawn from shares that agree with those badges.
    expect(mml.recentShare).toBeGreaterThan(mml.priorShare)
    expect(board.topics.map((t) => t.key)).toEqual(["graphs", "mml"])
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

  it("a representative-paper fetch failure yields papers: [] with the row still present", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const failingFetch: TopWorksFn = async () => {
      throw new Error("openalex exploded")
    }
    const board = await runTrendingBoard(
      storage,
      baseOpts({ topWorksFn: failingFetch, providerOverride: { strong: provider } }),
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
    const bigCount: CountFn = countFnFor(ONE_DISCIPLINE, 5000)
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
    // Prior lookups keep answering from the spec; only the anchor-wide totals differ.
    const perAnchor: CountFn = async (q) => (isPriorLookup(q) ? countFn(q) : q.query === "Neuroscience" ? 1000 : 300)
    const provider = new MockProvider([structured(BRIEFS_ONE), structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ topicGroupFn: topicGroupFnFor(spec), countFn: perAnchor, providerOverride: { strong: provider } }),
    )
    expect(board.overview.totalRecent).toBe(1300)
  })

  it("overview totalRecent falls back to the group buckets when the corpus count fails — but the ranking does NOT", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    // Both anchor-wide corpus counts fail; the per-topic prior lookups still
    // resolve.
    const failingTotal: CountFn = async (q) => {
      if (isPriorLookup(q)) return countFn(q)
      throw new Error("openalex down")
    }
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ countFn: failingTotal, providerOverride: { strong: provider } }),
    )
    // The overview may show the summed buckets: low but honest, never blank.
    expect(board.overview.totalRecent).toBe(62) // 40 + 20 + 2
    // The RANKING may not: the bucket sum is truncated at 200 groups, and using
    // it as a share denominator would inflate every recent share. With no
    // measured corpus size there is no share, and ranking those rows on raw
    // counts instead is precisely the indexing-lag artifact this design
    // removes — so they drop.
    expect(board.topics).toEqual([])
  })

  it("a failed PRIOR corpus count drops only the rows that divide by it — genuine 'new' rows survive", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const spec: GroupSpec = {
      Neuroscience: {
        recent: [
          { key: "T1", label: "Ratio Row", count: 40 },
          { key: "T2", label: "Genuinely New", count: 20 },
        ],
        prior: { T1: 10, T2: 0 },
      },
    }
    const base = countFnFor(spec)
    const failPriorTotal: CountFn = async (q) => {
      if (isPriorCorpusTotal(q)) throw new Error("openalex 429")
      return base(q)
    }
    const provider = new MockProvider([structured({ topics: [], crossDisciplineNote: null })])
    const board = await runTrendingBoard(
      storage,
      baseOpts({
        topicGroupFn: topicGroupFnFor(spec),
        countFn: failPriorTotal,
        providerOverride: { strong: provider },
      }),
    )
    // A zero prior needs no prior-corpus denominator to be "new"; a ratio row
    // does, and an unmeasured corpus is unknown rather than unchanged.
    expect(board.topics.map((t) => t.key)).toEqual(["T2"])
    expect(board.topics[0].growth).toBeNull()
    expect(board.topics[0].priorShare).toBe(0)
  })

  it("a failed prior-count lookup drops only that topic (an unmeasured prior is never read as zero)", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const failT1: CountFn = async (q) => {
      if (isPriorLookup(q) && q.topicId === "T1") throw new Error("openalex 429")
      return countFn(q)
    }
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(storage, baseOpts({ countFn: failT1, providerOverride: { strong: provider } }))
    // T1 would otherwise headline the board at +300%; a missing prior must not
    // become priorCount 0 and relabel it "new".
    expect(board.topics.map((t) => t.key)).toEqual(["T2"])
  })

  it("breakouts are scoped to the anchor (field id + label), over their own wider window, ranked by citations", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const requests: Array<Parameters<TopWorksFn>[0]> = []
    const recording: TopWorksFn = async (q) => {
      requests.push(q)
      return topWorksFnFor(CORPUS)(q)
    }
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ topWorksFn: recording, providerOverride: { strong: provider } }),
    )

    // Papers carrying no leaderboard topic at all, citation-ranked.
    expect(board.breakouts.map((b) => b.record.title)).toEqual([
      "Cortical mapping in neuroscience",
      "Neuroscience methods roundup",
    ])
    expect(board.breakouts[0].citationCount).toBe(9)

    // Scope + window of the request itself: the anchor's OpenAlex field id AND
    // its label, over a window that starts well before the leaderboard's.
    const breakoutRequest = requests.find((q) => q.fieldId !== undefined)!
    expect(breakoutRequest.fieldId).toBe(NEURO.id)
    expect(breakoutRequest.query).toBe("Neuroscience")
    expect(breakoutRequest.topicId).toBeUndefined()
    expect(breakoutRequest.toDate).toBe(WINDOWS.recent.toDate)
    expect(breakoutRequest.fromDate < WINDOWS.recent.fromDate).toBe(true)
  })

  it("a fallback anchor (an interest slug, not an OpenAlex field key) is scoped by label alone — never by a bogus filter", async () => {
    const storage = new MemoryVaultStorage()
    // No stored anchors and a derivation that yields nothing → the board falls
    // back to the interest label itself, whose "id" is a slug.
    const requests: Array<Parameters<TopWorksFn>[0]> = []
    const recording: TopWorksFn = async (q) => {
      requests.push(q)
      return []
    }
    const provider = new MockProvider([structured({ topics: [], crossDisciplineNote: null })])
    await runTrendingBoard(
      storage,
      baseOpts({
        fieldGroupFn: async () => [],
        topicGroupFn: topicGroupFnFor({ "auditory attention decoding": ONE_DISCIPLINE.Neuroscience }),
        countFn: countFnFor({ "auditory attention decoding": ONE_DISCIPLINE.Neuroscience }),
        topWorksFn: recording,
        providerOverride: { strong: provider },
      }),
    )
    const breakoutRequest = requests.find((q) => q.topicId === undefined)!
    expect(breakoutRequest.query).toBe("auditory attention decoding")
    expect(breakoutRequest.fieldId).toBeUndefined()
  })

  it("breakouts exclude other fields, uncited papers, and anything older than the breakout window", async () => {
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    // Each of these matches the anchor's text scope and fails exactly one of
    // the strip's other conditions.
    const corpus: FakeWork[] = [
      { topicId: "T1", fieldId: "https://openalex.org/fields/17", record: paper({ title: "Neuroscience, but filed under another field", date: WINDOWS.recent.fromDate, citationCount: 500 }) },
      { topicId: "T1", fieldId: NEURO.id, record: paper({ title: "Recent neuroscience, uncited", date: WINDOWS.recent.fromDate, citationCount: 0 }) },
      { topicId: "T1", fieldId: NEURO.id, record: paper({ title: "Cited neuroscience, but ancient", date: "2019-01-01", citationCount: 9000 }) },
    ]
    const provider = new MockProvider([structured(BRIEFS_ONE)])
    const board = await runTrendingBoard(
      storage,
      baseOpts({ topWorksFn: topWorksFnFor(corpus), providerOverride: { strong: provider } }),
    )
    expect(board.breakouts).toEqual([])
    expect(board.topics.length).toBeGreaterThan(0) // the rest of the board is unaffected
  })

  it("REGRESSION: representative papers come from the topic's ID, never a search for its NAME", async () => {
    // The live failure (2026-07-25): the row "Teaching and Learning Programming"
    // carried "English Language Teaching and Learning Program", "Teaching styles
    // of Australian tennis coaches" and "Rewiring our teaching practice" — three
    // papers whose only connection to the topic is the words in its label. The
    // decoys below are more-cited than the real paper, so a name-based fetch
    // (or a fetch that merely added the label as a text scope) would rank them
    // first and this test would fail on the titles alone.
    const storage = new MemoryVaultStorage()
    await seedAnchors(storage, [NEURO])
    const spec: GroupSpec = {
      Neuroscience: {
        recent: [{ key: "T10533", label: "Teaching and Learning Programming", count: 40 }],
        prior: { T10533: 10 },
      },
    }
    const corpus: FakeWork[] = [
      { topicId: "T10533", fieldId: NEURO.id, record: paper({ title: "What Bugs Do Prolog Students Write?", date: WINDOWS.recent.fromDate, citationCount: 1 }) },
      { topicId: "T10008", fieldId: NEURO.id, record: paper({ title: "English Language Teaching and Learning Program", date: WINDOWS.recent.fromDate, citationCount: 80 }) },
      { topicId: "T12671", fieldId: NEURO.id, record: paper({ title: "Teaching styles of Australian tennis coaches", date: WINDOWS.recent.fromDate, citationCount: 60 }) },
      { topicId: "T12671", fieldId: NEURO.id, record: paper({ title: "Rewiring our teaching practice", date: WINDOWS.recent.fromDate, citationCount: 50 }) },
    ]
    const requests: Array<Parameters<TopWorksFn>[0]> = []
    const recording: TopWorksFn = async (q) => {
      requests.push(q)
      return topWorksFnFor(corpus)(q)
    }
    const provider = new MockProvider([structured({ topics: [], crossDisciplineNote: null })])
    const board = await runTrendingBoard(
      storage,
      baseOpts({
        topicGroupFn: topicGroupFnFor(spec),
        countFn: countFnFor(spec),
        topWorksFn: recording,
        providerOverride: { strong: provider },
      }),
    )

    const row = board.topics.find((t) => t.key === "T10533")!
    expect(row.papers.map((p) => p.record.title)).toEqual(["What Bugs Do Prolog Students Write?"])

    // The request itself, not just its result: the topic id is the scope and
    // the label never becomes a text query.
    const topicRequests = requests.filter((q) => q.topicId !== undefined)
    expect(topicRequests).toHaveLength(1)
    expect(topicRequests[0].topicId).toBe("T10533")
    expect(topicRequests[0].query).toBeUndefined()
    expect(requests.every((q) => q.query !== "Teaching and Learning Programming")).toBe(true)
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
      "wiki/papers/attention-decoding-at-scale.md",
      [
        "---",
        "type: paper",
        "title: Attention decoding at scale",
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
    expect(topic.papers[0].wikiPageId).toBe("wiki/papers/attention-decoding-at-scale")
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
