import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { PaperRecord } from "../papers/types"
import { paperKey } from "../papers/types"
import type { TopicGroupFn, TopWorksFn } from "../papers/node-search"
import { findPaperPage } from "../papers/page-state"
import { paperSlug } from "../wiki/authoring"
import { loadBundle, type Bundle } from "../vault/bundle"
import { runSkill } from "../skills/runner"
import { logEvent } from "../events/log"
import type { TrackedField } from "./fields"
import type { Cadence } from "./settings"
import { loadTrendingSettings, saveDerivedAnchors } from "./settings"
import type { AnchorDiscipline } from "./anchors"
import { deriveAnchorDisciplines, openAlexFieldId, MAX_ANCHORS } from "./anchors"
import {
  completeWindows,
  rankHeatingTopics,
  selectTopicCandidates,
  type DateWindow,
  type CorpusTotals,
  type DisciplineBuckets,
  type RankedTopic,
} from "./topics"
import { topicLens } from "./lens"
import type { CountFn } from "./counts"
import { trendingSkill } from "../skills/trending"

/**
 * Structure version of the cached board (`.scispark/trending/dashboard.json`).
 * Bumped whenever the persisted shape changes; `loadBoard` treats any other
 * version — including the M10/v1.1 shape, which carried no `version` at all —
 * as a cold start rather than parsing it into the wrong type.
 *
 * 3: `weekly` (the sparkline series) replaced by `priorCount` (the before/after
 * bars). A v2 board carries no `priorCount`, so rendering one would size the
 * bars off `undefined` — the bump makes it a cold start instead.
 * 4: growth is a ratio of SHARES of the discipline corpus, and the bars are
 * drawn from `recentShare`/`priorShare`. A v3 board carries neither field, so
 * rendering one would size every bar off `undefined`; cold-start instead.
 */
export const TRENDING_BOARD_VERSION = 4

export interface BoardPaper {
  record: PaperRecord
  /** Wiki page id when this paper already exists in the vault; null otherwise. Never a count — the KB connection is a link or nothing (SP4 §4). */
  wikiPageId: string | null
}

export interface BoardTopic {
  key: string
  label: string
  /** The anchor discipline this topic was ranked within (an `AnchorDiscipline.label`). */
  discipline: string
  /**
   * Change in the topic's SHARE of its discipline: (recentShare − priorShare) /
   * priorShare. Null when the prior count is too small to divide by (zero, or
   * under `MIN_PRIOR_COUNT`) — rendered as "new", never ∞.
   * Share-based because OpenAlex's indexing lag shrinks the recent window's
   * corpus for every topic alike, which raw counts would read as a board-wide
   * decline (see `rankHeatingTopics` for the measured figures).
   */
  growth: number | null
  recentCount: number
  /**
   * The topic's TRUE prior-window count (`lookupPriorCounts`). Kept alongside
   * `recentCount` as honest ABSOLUTE volume — rendered as text on the expanded
   * row, never drawn to scale (bars are share-scaled, below).
   */
  priorCount: number
  /**
   * The two shares `growth` is computed from: `recentCount / discipline's
   * recent-window corpus` and `priorCount / its prior-window corpus`. The row's
   * before/after bars are drawn from THESE, so a row's chart can never
   * contradict its badge — a topic whose raw count fell while its share rose
   * must not show a shrinking bar beside a positive percentage. `priorShare: 0`
   * is the "new" case (a prior of zero, or one under `MIN_PRIOR_COUNT`) and
   * draws an empty prior bar; `priorCount` still carries the honest raw figure.
   */
  recentShare: number
  priorShare: number
  papers: BoardPaper[]
  /** LLM-written; null when the skill failed for this topic's discipline, or when the model returned no brief whose `key` matched this topic verbatim. */
  why: string | null
  relevant: boolean
}

export interface BoardOverview {
  /** Real OpenAlex work count over the complete recent window, summed across the anchor disciplines (a work matching two anchors is counted twice). */
  totalRecent: number
  topTopicLabel: string | null
  topTopicGrowth: number | null
  relevantCount: number
}

export interface TrendingBoard {
  version: number
  anchors: AnchorDiscipline[]
  overview: BoardOverview
  topics: BoardTopic[]
  breakouts: Array<{ record: PaperRecord; citationCount: number; wikiPageId: string | null }>
  crossDisciplineNote: string | null
  /**
   * Present iff at least one discipline's qualitative survey failed. Carries
   * the real reason(s) so the failure is surfaced instead of a silent set of
   * null `why`s — the M10 failure-honesty rule (a survey that fails quietly
   * while still billing was a real bug). Failed structured calls stay metered:
   * their spend is still accumulated into the `trending_refresh` event.
   */
  surveyError?: string
  /**
   * Present iff a DETERMINISTIC retrieval step failed: a discipline's topic
   * grouping, a corpus-size count, or a candidate's prior-count lookup. Those
   * failures correctly DROP the affected rows (never falling back to raw
   * counts), which means they can silently empty the whole leaderboard — and an
   * empty leaderboard renders "No topic cleared the activity threshold", a
   * confident statement about the data when the truth is a failed fetch.
   * Carrying the reason applies the same failure-honesty rule the LLM layer
   * already follows via `surveyError`.
   */
  dataError?: string
  generatedAt: string
}

export const DASHBOARD_CACHE_PATH = ".scispark/trending/dashboard.json"

const DAY_MS = 24 * 60 * 60 * 1000
const CADENCE_MS: Record<Cadence, number> = { daily: DAY_MS, weekly: 7 * DAY_MS }

/** Representative papers fetched (and rendered) per leaderboard topic. */
const MAX_TOPIC_PAPERS = 3
/** Breakout papers kept for the secondary strip. */
const MAX_BREAKOUTS = 5
/**
 * How far back the breakout strip looks, ending where the leaderboard's recent
 * window ends. Deliberately MUCH wider than that two-week window: citations
 * take months to accrue, so "most-cited papers of the last fortnight" is a list
 * of ones and zeros (measured live 2026-07-25 over Computer Science: 79, 5, 4,
 * 3, 3, 2, 1, 1 citations), whereas the same query over a quarter returns
 * papers with 1420 / 79 / 75 / 40 / 35. The strip's label says the window out
 * loud rather than implying these are papers from the board's own window.
 */
const BREAKOUT_WINDOW_DAYS = 90

export interface RunTrendingBoardOpts {
  /** The user's narrow interest labels (the LENS, and the fallback scope when anchor derivation fails). */
  fields: TrackedField[]
  /**
   * OpenAlex works, entity-scoped and citation-ranked (`searchTopCitedWorks`).
   * Every paper the board shows comes from here: a row's representative papers
   * are filtered by that row's `primary_topic.id`, and the breakout strip by
   * the anchor discipline — so a paper can never be shown under a topic it
   * doesn't carry (which is exactly what a name-based search did).
   */
  topWorksFn: TopWorksFn
  /** OpenAlex `group_by=primary_topic.id` — the leaderboard's per-topic counts. */
  topicGroupFn: TopicGroupFn
  /** OpenAlex `group_by=primary_topic.field.id` — anchor-discipline derivation. */
  fieldGroupFn: TopicGroupFn
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
  /** Fires with each anchor discipline's label as its group-by requests start. */
  onProgress?: (discipline: string) => void
  /**
   * Real OpenAlex work counter (`countOpenAlexWorks`). REQUIRED: it produces
   * the overview's recent-work totals, each anchor's corpus size in both
   * windows (the share denominators) and every candidate's prior count — i.e.
   * the growth column AND the before/after bars. Without it there is no
   * leaderboard at all, so this is a hard dep rather than an enhancement.
   */
  countFn: CountFn
}

/**
 * Orchestrates the "Academia Right Now" board (SP4) — the blessed pattern:
 * this module owns retrieval, ranking, and storage so `trendingSkill`
 * (src/lib/skills/trending.ts) stays a pure LLM unit.
 *
 * Per refresh: resolve anchor disciplines (a non-empty stored list, else
 * derived and persisted, else the narrow interest labels) → `completeWindows(now)` → ONE
 * recent-window `topicGroupFn` call per anchor → each anchor's corpus size in
 * BOTH windows (`measureCorpusTotals`, two counts per anchor — the share
 * denominators) → a prior-count lookup per candidate (`lookupPriorCounts`) →
 * `rankHeatingTopics` → one
 * topic-id-filtered representative-paper request per kept topic → one
 * discipline-scoped, citation-ranked breakout request per anchor
 * → one `runSkill(trendingSkill)` per anchor discipline → the deterministic
 * lens → assemble + persist.
 *
 * There is NO per-topic time series: the row's chart is two bars drawn from
 * the same two SHARES the growth badge is computed from, which costs zero
 * extra requests and makes a chart-vs-badge contradiction structurally
 * impossible.
 *
 * EVERY number on the board comes from OpenAlex counts. The skill's input
 * structurally carries no counts/percentages/dates, and its briefs are joined
 * back onto the ranking by `key` VERBATIM — an unmatched key leaves that
 * topic's `why` null rather than attaching text to the wrong topic.
 *
 * Every layer degrades independently: a failed discipline drops only its own
 * topics, a failed paper search yields `papers: []`, and a failed skill leaves
 * the whole ranking intact with `why: null` plus a `surveyError` stating the
 * real reason. The degradations that can cost ROWS are the deterministic ones —
 * a failed topic grouping, a failed CORPUS count (`measureCorpusTotals`, whose
 * share denominator is then unknown; ranking on raw counts instead is the very
 * artifact this design removes) and a failed prior-count lookup. Those rows are
 * dropped rather than silently computed a different way, and the reason is
 * carried on the board as `dataError` so an emptied leaderboard never reads as
 * "nothing is trending".
 *
 * Concurrency: a scheduler/automation (`maybeAutoRefreshTrending`) and a
 * manual /trending refresh can both observe a stale/missing cache and fire at
 * once for the same vault. Concurrent calls for the SAME
 * `storage` share one in-flight run — every caller gets the same
 * `TrendingBoard` promise/object, and the strong-tier skill runs (and the
 * `trending_refresh` event logs) only once, not once per caller. A call made
 * AFTER the shared run has settled starts a fresh run (so the manual Refresh
 * button still works). Note: the shared run uses only the FIRST caller's
 * `opts` — a second concurrent caller's opts are ignored. This is safe today
 * because current call sites derive identical effective fields from the same
 * trending settings; if a future
 * caller needs guaranteed-distinct opts honored concurrently, it must key the
 * in-flight map on more than just `storage`.
 */
const inFlight = new WeakMap<VaultStorage, Promise<TrendingBoard>>()

export async function runTrendingBoard(storage: VaultStorage, opts: RunTrendingBoardOpts): Promise<TrendingBoard> {
  const existing = inFlight.get(storage)
  if (existing) return existing

  const run = runTrendingBoardUncached(storage, opts).finally(() => {
    inFlight.delete(storage)
  })
  inFlight.set(storage, run)
  return run
}

async function runTrendingBoardUncached(storage: VaultStorage, opts: RunTrendingBoardOpts): Promise<TrendingBoard> {
  const now = opts.now ?? (() => new Date())
  const generatedAt = now().toISOString()
  const at = now()
  const windows = completeWindows(at)
  const interestLabels = opts.fields.map((f) => f.label)

  const anchors = await resolveAnchors(storage, opts, windows.recent)

  // --- Deterministic ranking -------------------------------------------------
  // ONE group_by request per anchor, over the RECENT window only: it yields the
  // candidate topics and their recent counts. A discipline whose request fails
  // drops out of the ranking entirely; the others are unaffected.
  // Every deterministic-retrieval failure lands here and is surfaced on the
  // board as `dataError`. These failures drop rows on purpose (a missing count
  // is unknown, never zero), so without this sink a fetch outage renders as a
  // confident "nothing is trending" — see `TrendingBoard.dataError`.
  const dataErrors: string[] = []

  const perDiscipline: DisciplineBuckets[] = []
  for (const anchor of anchors) {
    opts.onProgress?.(anchor.label)
    try {
      const recent = await opts.topicGroupFn({ query: anchor.label, ...windows.recent })
      perDiscipline.push({ discipline: anchor.label, recent })
    } catch (err) {
      console.warn(`[trending] topic grouping failed for "${anchor.label}":`, err)
      dataErrors.push(`${anchor.label}: topic activity lookup failed (${describeError(err)})`)
    }
  }
  // Each anchor's corpus size in BOTH windows (one count request each): the
  // denominators every growth figure and every bar is scaled by.
  const recentTotals = await measureCorpusTotals(opts, perDiscipline, windows.recent, dataErrors)
  const priorTotals = await measureCorpusTotals(opts, perDiscipline, windows.prior, dataErrors)
  const corpusTotals = new Map<string, CorpusTotals>(
    perDiscipline.map(({ discipline }) => [
      discipline,
      { recent: recentTotals.get(discipline) ?? null, prior: priorTotals.get(discipline) ?? null },
    ]),
  )
  const priorCounts = await lookupPriorCounts(opts, perDiscipline, windows.prior, dataErrors)
  const ranked = rankHeatingTopics(perDiscipline, priorCounts, corpusTotals)
  const totalRecent = sumRecentWorks(perDiscipline, recentTotals)

  // --- Per-topic enrichment (representative papers) ---------------------------
  // Sequential on purpose: at most MAX_LEADERBOARD_TOPICS topics, and OpenAlex
  // is credit-priced and rate-limited — bounded, predictable load beats speed.
  const enriched: Array<{ topic: RankedTopic; papers: PaperRecord[] }> = []
  for (const topic of ranked) {
    const papers = await fetchTopicPapers(opts, topic, windows.recent)
    enriched.push({ topic, papers })
  }

  // --- Deterministic breakouts (citation-ranked, across the anchors) ----------
  const breakoutRecords = await retrieveBreakouts(opts, anchors, windows.recent)

  // --- Qualitative layer: one strong-tier call per anchor discipline ----------
  const whyByKey = new Map<string, string>()
  const surveyErrors: string[] = []
  let crossDisciplineNote: string | null = null
  let costUsd = 0

  for (const anchor of anchors) {
    const forDiscipline = enriched.filter((e) => e.topic.discipline === anchor.label)
    if (forDiscipline.length === 0) continue

    const run = await runSkill({
      skill: trendingSkill,
      input: {
        discipline: anchor.label,
        // No counts, percentages or dates — the model has no figures available
        // to echo (see src/lib/skills/trending.ts).
        topics: forDiscipline.map((e) => ({
          key: e.topic.key,
          label: e.topic.label,
          paperTitles: e.papers.map((p) => p.title).filter((t): t is string => Boolean(t)),
        })),
      },
      storage,
      settings: opts.settings,
      providerOverride: opts.providerOverride,
      now: opts.now,
    })
    // A failed structured call is still metered by the harness, so its spend
    // counts toward this refresh either way.
    costUsd += run.costUsd

    if (run.status === "ok" && run.output !== undefined) {
      const knownKeys = new Set(forDiscipline.map((e) => e.topic.key))
      for (const brief of run.output.topics) {
        // Verbatim join: a brief whose key matches no ranked topic of this
        // discipline is DROPPED, never reassigned to a neighbouring topic.
        if (knownKeys.has(brief.key)) whyByKey.set(brief.key, brief.why)
      }
      // One note for the whole board: the first discipline that produced one
      // wins (the field is singular by design — SP4 §1's overview is a single
      // line, not one note per discipline).
      if (crossDisciplineNote === null && run.output.crossDisciplineNote) {
        crossDisciplineNote = run.output.crossDisciplineNote
      }
    } else {
      surveyErrors.push(
        `${anchor.label}: ${run.error ?? `trending skill finished with status "${run.status}"`}`,
      )
    }
  }

  // --- The lens (pure, deterministic) ----------------------------------------
  const bundle = await loadBundle(storage).catch((err): Bundle => {
    console.warn("[trending] bundle load failed; the lens degrades to no links:", err)
    return { pages: new Map(), links: [], errors: [] }
  })

  const topics: BoardTopic[] = enriched.map(({ topic, papers }) => {
    // The lens is pure, but it walks user-editable frontmatter (tags); one
    // malformed page must not blank the board, so a throw degrades this row to
    // "not relevant" instead. Per-paper wiki links are resolved separately
    // (`resolveWikiPageId`) and are unaffected.
    let lens = { relevant: false }
    try {
      lens = topicLens({ label: topic.label }, interestLabels, bundle)
    } catch (err) {
      console.warn(`[trending] lens failed for "${topic.label}":`, err)
    }
    return {
      key: topic.key,
      label: topic.label,
      discipline: topic.discipline,
      growth: topic.growth,
      recentCount: topic.recentCount,
      priorCount: topic.priorCount,
      recentShare: topic.recentShare,
      priorShare: topic.priorShare,
      papers: papers.map((record) => ({ record, wikiPageId: resolveWikiPageId(bundle, record) })),
      why: whyByKey.get(topic.key) ?? null,
      relevant: lens.relevant,
    }
  })

  const board: TrendingBoard = {
    version: TRENDING_BOARD_VERSION,
    anchors,
    overview: {
      totalRecent,
      topTopicLabel: topics[0]?.label ?? null,
      topTopicGrowth: topics[0]?.growth ?? null,
      relevantCount: topics.filter((t) => t.relevant).length,
    },
    topics,
    breakouts: breakoutRecords.map((record) => ({
      record,
      citationCount: record.citationCount ?? 0,
      wikiPageId: resolveWikiPageId(bundle, record),
    })),
    crossDisciplineNote,
    ...(surveyErrors.length > 0 ? { surveyError: surveyErrors.join("; ") } : {}),
    ...(dataErrors.length > 0 ? { dataError: dataErrors.join("; ") } : {}),
    generatedAt,
  }

  await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify(board, null, 2))
  await logEvent(storage, { type: "trending_refresh", fieldCount: opts.fields.length, costUsd }, now)
  return board
}

/**
 * A NON-EMPTY stored list is authoritative — hand-set or already-derived, it is
 * never silently recomputed. An EMPTY list means "derive", *regardless of
 * `anchorsOverridden`*: the settings editor produces `{anchors: [], overridden:
 * true}` when the user removes the last anchor chip, and honoring the flag
 * there would leave the board silently scoped by the narrow interest labels —
 * exactly the scoping SP4 exists to replace — with nothing to show for it.
 *
 * Only when derivation itself yields nothing (every lookup failed, or there are
 * no labels) does the board fall back to the narrow labels as anchors, so the
 * page still renders. That fallback is NOT persisted: the next refresh retries
 * the real derivation.
 */
async function resolveAnchors(
  storage: VaultStorage,
  opts: RunTrendingBoardOpts,
  recentWindow: { fromDate: string; toDate: string },
): Promise<AnchorDiscipline[]> {
  const settings = await loadTrendingSettings(storage).catch(() => null)
  if (settings && settings.anchors.length > 0) return settings.anchors

  const derived = await deriveAnchorDisciplines(
    opts.fields.map((f) => f.label),
    opts.fieldGroupFn,
    recentWindow,
  ).catch(() => [] as AnchorDiscipline[])
  if (derived.length > 0) {
    // Patched inside the settings write-lock (never a snapshot-then-overwrite):
    // a cadence/fields edit made while derivation was in flight must survive.
    await saveDerivedAnchors(storage, derived).catch((err) => {
      console.warn("[trending] persisting derived anchors failed:", err)
    })
    return derived
  }

  return opts.fields.slice(0, MAX_ANCHORS).map((f) => ({ id: f.slug, label: f.label }))
}

/**
 * The candidates' TRUE prior-window counts — one filtered count request each
 * (`primary_topic.id:<key>` + the prior date range), which is the whole point
 * of the fix in SP4 §3: OpenAlex caps a grouped response at 200 buckets and
 * the prior window's visibility threshold sits HIGHER than the recent one's
 * (older papers are indexed more completely), so reading a prior count off a
 * second `group_by` list scored every mid-sized topic as `prior: 0` → "new".
 * A count request has no such horizon.
 *
 * Each lookup carries the SAME `query` (the discipline label) as the grouped
 * call its recent count came from — the count is `search`-scoped too, and an
 * unscoped lookup would return the corpus-wide figure and invent a decline.
 *
 * Sequential and pool-bounded (CANDIDATE_POOL requests per refresh, not one
 * per bucket): OpenAlex is credit-priced and rate-limited. A failed lookup
 * simply omits its key, and `rankHeatingTopics` drops that topic rather than
 * reading the gap as a zero.
 */
async function lookupPriorCounts(
  opts: RunTrendingBoardOpts,
  perDiscipline: DisciplineBuckets[],
  priorWindow: { fromDate: string; toDate: string },
  dataErrors: string[],
): Promise<Map<string, number>> {
  const priorCounts = new Map<string, number>()
  for (const candidate of selectTopicCandidates(perDiscipline)) {
    try {
      priorCounts.set(
        candidate.key,
        await opts.countFn({ query: candidate.discipline, topicId: candidate.key, ...priorWindow }),
      )
    } catch (err) {
      console.warn(`[trending] prior-count lookup failed for "${candidate.label}":`, err)
      dataErrors.push(`${candidate.label}: earlier-window count failed (${describeError(err)})`)
    }
  }
  return priorCounts
}

/**
 * Each anchor discipline's CORPUS SIZE over one window — one real `countFn`
 * call per anchor, unscoped by topic. Two roles:
 *
 *  - the recent map is the overview's "new papers this window";
 *  - both maps are the denominators `rankHeatingTopics` turns raw counts into
 *    shares with, which is what makes OpenAlex's indexing lag cancel.
 *
 * A count is used rather than a sum of the `group_by` buckets we already have
 * because group_by caps at 200 groups: the bucket sum silently truncates the
 * long tail and understates the corpus. That matters doubly as a denominator —
 * a truncated recent total against a real prior total would inflate every
 * topic's recent share and manufacture board-wide growth — so a failed count
 * is simply OMITTED here. The overview falls back to the bucket sum for
 * display (`sumRecentWorks`); the ranking treats a missing size as unknown and
 * drops those rows.
 */
async function measureCorpusTotals(
  opts: RunTrendingBoardOpts,
  perDiscipline: DisciplineBuckets[],
  window: { fromDate: string; toDate: string },
  dataErrors: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  for (const { discipline } of perDiscipline) {
    try {
      totals.set(discipline, await opts.countFn({ query: discipline, ...window }))
    } catch (err) {
      console.warn(`[trending] corpus count failed for "${discipline}" (${window.fromDate}..${window.toDate}):`, err)
      dataErrors.push(
        `${discipline}: corpus size for ${window.fromDate}..${window.toDate} failed (${describeError(err)})`,
      )
    }
  }
  return totals
}

/** One short line for a caught unknown — never a stack, never "[object Object]". */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * "New papers this window" across the anchor disciplines.
 *
 * CAVEAT (carried into the UI label): a work matching two anchors' searches is
 * counted once per anchor, so overlapping disciplines can double-count. An
 * anchor whose count failed falls back to its summed buckets — a low-but-honest
 * number beats a missing figure. That fallback is display-only and deliberately
 * NOT reused as a share denominator (see `measureCorpusTotals`).
 */
function sumRecentWorks(perDiscipline: DisciplineBuckets[], recentTotals: Map<string, number>): number {
  let total = 0
  for (const { discipline, recent } of perDiscipline) {
    total += recentTotals.get(discipline) ?? recent.reduce((s, entry) => s + entry.count, 0)
  }
  return total
}

/**
 * A row's representative papers: works OpenAlex classifies under THAT TOPIC ID,
 * published inside the same recent window the row's counts are measured over,
 * most-cited first.
 *
 * The topic id — never the label — is the scope. A topic's label is prose that
 * happens to name it; searching for the text returned papers with no connection
 * to the topic whenever the label used common words (live, 2026-07-25: "Teaching
 * and Learning Programming" produced "Teaching styles of Australian tennis
 * coaches" and "Rewiring our teaching practice"). Every other figure on the row
 * — recent count, prior count, growth, both bars — is measured by
 * `primary_topic.id`, so the papers must be as well, otherwise the row's
 * evidence contradicts its own numbers. The brief-writing skill sees these
 * titles too, so an off-topic set poisons the qualitative layer as well.
 *
 * `[]` on any failure — the expanded row shows text only.
 */
async function fetchTopicPapers(
  opts: RunTrendingBoardOpts,
  topic: RankedTopic,
  window: DateWindow,
): Promise<PaperRecord[]> {
  try {
    const papers = await opts.topWorksFn({
      topicId: topic.key,
      fromDate: window.fromDate,
      toDate: window.toDate,
      limit: MAX_TOPIC_PAPERS,
    })
    return papers.slice(0, MAX_TOPIC_PAPERS)
  } catch (err) {
    console.warn(`[trending] representative-paper fetch failed for "${topic.label}" (${topic.key}):`, err)
    return []
  }
}

/**
 * Breakout papers: the most-cited papers published across the anchor
 * disciplines in the last BREAKOUT_WINDOW_DAYS — one request per anchor,
 * merged, deduped and re-ranked.
 *
 * REPLACES an intersection that could never produce anything (the live board
 * reported `breakouts: 0` on every single run). It took `retrieveFieldCandidates`'
 * citation-sorted `movers` and kept only records also present in its
 * date-filtered `recent` list, but the two lists come from disjoint sources by
 * construction: the OpenAlex half is a relevance-ranked, undated search whose
 * results are field classics (searching "Computer Science" live on 2026-07-25
 * returned 25 works dated 1975–2020, zero inside a two-week window), while the
 * arXiv half is genuinely recent but the arXiv API returns no citation counts
 * at all (`citationCount: undefined` in the adapter), so every arXiv record
 * failed the `citationCount > 0` test. Recent ∧ cited was therefore empty for
 * reasons that had nothing to do with the arXiv timeouts seen in the live runs.
 *
 * Scoping: the anchor's label as the text scope, PLUS `primary_topic.field.id`
 * when the anchor carries a real OpenAlex field key (a fallback anchor's id is
 * an interest slug, which is no filter value at all). Both, not either —
 * measured live 2026-07-25 over a 90-day window, dropping the text scope let
 * re-dated classics and preprint-farm records top the strip ("Givenness,
 * Contrastiveness, Definiteness…", a 1976 linguistics paper carrying 1843
 * citations, headlined Computer Science; Neuroscience returned "Shakti: A
 * Trauma-Informed Trilingual Women's Safety AI"), while keeping it returned
 * recognisable recent work in both (connectome control circuits, precision fMRI
 * / M2SNet, HuntGPT). It also matches how every other figure on the board is
 * scoped: the discipline's corpus counts are `search`-scoped too.
 * `is_paratext:false` inside `searchTopCitedWorks` keeps journal-level records
 * off the strip.
 *
 * A record with no positive citation count is still dropped — "breakout" has to
 * mean something — and an empty strip remains an honest outcome (the component
 * renders nothing) rather than a padded one.
 */
async function retrieveBreakouts(
  opts: RunTrendingBoardOpts,
  anchors: AnchorDiscipline[],
  recentWindow: DateWindow,
): Promise<PaperRecord[]> {
  const fromDate = shiftIsoDate(recentWindow.toDate, -BREAKOUT_WINDOW_DAYS)
  const merged = new Map<string, PaperRecord>()

  for (const anchor of anchors) {
    const fieldId = openAlexFieldId(anchor)
    try {
      const records = await opts.topWorksFn({
        query: anchor.label,
        fieldId,
        fromDate,
        toDate: recentWindow.toDate,
        limit: MAX_BREAKOUTS,
      })
      for (const record of records) {
        if (typeof record.citationCount !== "number" || record.citationCount <= 0) continue
        const key = paperKey(record)
        const existing = merged.get(key)
        if (!existing || (existing.citationCount ?? 0) < record.citationCount) merged.set(key, record)
      }
    } catch (err) {
      console.warn(`[trending] breakout retrieval failed for "${anchor.label}":`, err)
    }
  }

  return [...merged.values()]
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    .slice(0, MAX_BREAKOUTS)
}

/** `date` (YYYY-MM-DD) shifted by whole days, back as YYYY-MM-DD. */
function shiftIsoDate(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

/** null on any failure (including a malformed record that can't be slugified) — the row simply carries no wiki link. */
function resolveWikiPageId(bundle: Bundle, record: PaperRecord): string | null {
  try {
    return findPaperPage(bundle, paperSlug(record))?.id ?? null
  } catch {
    return null
  }
}

/**
 * Reads the cached board. Returns null — a cold start, never a crash — when the
 * file is missing, unparseable, or written by a different structure version
 * (notably the M10/v1.1 `{panels}` shape, which has no `version` field at all
 * and is still sitting on real users' disks).
 */
export async function loadBoard(storage: VaultStorage): Promise<TrendingBoard | null> {
  const raw = await storage.read(DASHBOARD_CACHE_PATH)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object") return null
    if (parsed.version !== TRENDING_BOARD_VERSION) return null
    if (!Array.isArray(parsed.topics) || typeof parsed.generatedAt !== "string") return null
    return parsed as TrendingBoard
  } catch {
    return null
  }
}

export function isStale(board: TrendingBoard | null, cadence: Cadence, now: Date): boolean {
  if (board == null) return true
  const gen = new Date(board.generatedAt).getTime()
  if (Number.isNaN(gen)) return true
  return now.getTime() - gen >= CADENCE_MS[cadence]
}

/**
 * True iff `board` is non-null and the SET of its anchor ids equals the set of
 * `anchors`' ids (order-insensitive). Detects a settings change (anchor edit,
 * reset-to-auto) that rescoped the board without a corresponding refresh — a
 * cache can be time-fresh but scope-stale, and showing a board for the wrong
 * anchors is actively misleading.
 */
export function anchorsMatchBoard(board: TrendingBoard | null, anchors: AnchorDiscipline[]): boolean {
  if (board == null) return false
  const boardIds = new Set(board.anchors.map((a) => a.id))
  const ids = new Set(anchors.map((a) => a.id))
  if (boardIds.size !== ids.size) return false
  for (const id of ids) {
    if (!boardIds.has(id)) return false
  }
  return true
}
