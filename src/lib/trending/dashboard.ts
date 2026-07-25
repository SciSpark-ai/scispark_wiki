import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { SearchFn } from "../skills/feed"
import type { PaperRecord } from "../papers/types"
import { paperKey } from "../papers/types"
import type { TopicGroupFn } from "../papers/node-search"
import { findPaperPage } from "../papers/page-state"
import { paperSlug } from "../wiki/authoring"
import { loadBundle, type Bundle } from "../vault/bundle"
import { runSkill } from "../skills/runner"
import { logEvent } from "../events/log"
import type { TrackedField } from "./fields"
import type { Cadence } from "./settings"
import { loadTrendingSettings, saveDerivedAnchors } from "./settings"
import type { AnchorDiscipline } from "./anchors"
import { deriveAnchorDisciplines, MAX_ANCHORS } from "./anchors"
import { completeWindows, rankHeatingTopics, selectTopicCandidates, type DisciplineBuckets, type RankedTopic } from "./topics"
import { topicLens } from "./lens"
import { retrieveFieldCandidates } from "./retrieve"
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
 */
export const TRENDING_BOARD_VERSION = 3

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
  /** (recent − prior) / prior; null when prior is 0 — rendered as "new", never ∞. */
  growth: number | null
  recentCount: number
  /**
   * The topic's TRUE prior-window count (`lookupPriorCounts`) — the very number
   * `growth` is computed from. The row's before/after bars are drawn from
   * {priorCount, recentCount}, so a row's chart can never contradict its growth
   * badge (the sparkline it replaced was a separately-fetched series that
   * could, and did). 0 means "genuinely new this window" and is drawn as an
   * empty prior bar.
   */
  priorCount: number
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
  generatedAt: string
}

export const DASHBOARD_CACHE_PATH = ".scispark/trending/dashboard.json"

const DAY_MS = 24 * 60 * 60 * 1000
const CADENCE_MS: Record<Cadence, number> = { daily: DAY_MS, weekly: 7 * DAY_MS }

/** Representative papers fetched (and rendered) per leaderboard topic. */
const MAX_TOPIC_PAPERS = 3
/** Breakout papers kept for the secondary strip. */
const MAX_BREAKOUTS = 5

export interface RunTrendingBoardOpts {
  /** The user's narrow interest labels (the LENS, and the fallback scope when anchor derivation fails). */
  fields: TrackedField[]
  searchFn: SearchFn
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
   * Real OpenAlex work counter (`countOpenAlexWorks`). REQUIRED: besides the
   * overview's recent-work totals, it performs every candidate's prior-count
   * lookup, which the growth column AND the before/after bars are computed
   * from — without it there is no leaderboard at all, so this is a hard dep
   * rather than an enhancement.
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
 * recent-window `topicGroupFn` call per anchor → a prior-count lookup per
 * candidate (`lookupPriorCounts`) → `rankHeatingTopics` → one
 * representative-paper search per kept topic → deterministic breakouts
 * → one `runSkill(trendingSkill)` per anchor discipline → the deterministic
 * lens → assemble + persist.
 *
 * There is NO per-topic time series: the row's chart is two bars drawn from
 * the prior/recent counts already in hand, which costs zero extra requests and
 * makes a chart-vs-badge contradiction structurally impossible.
 *
 * EVERY number on the board comes from OpenAlex counts. The skill's input
 * structurally carries no counts/percentages/dates, and its briefs are joined
 * back onto the ranking by `key` VERBATIM — an unmatched key leaves that
 * topic's `why` null rather than attaching text to the wrong topic.
 *
 * Every layer degrades independently and never blanks the board: a failed
 * discipline drops only its own topics, a failed paper search yields
 * `papers: []`, and a failed skill leaves the whole ranking intact with
 * `why: null` plus a `surveyError` stating the real reason.
 *
 * Concurrency: home's fire-and-forget auto-refresh (`maybeAutoRefreshTrending`)
 * and /trending's own mount-time refresh can both observe a stale/missing
 * cache and fire at once for the same vault. Concurrent calls for the SAME
 * `storage` share one in-flight run — every caller gets the same
 * `TrendingBoard` promise/object, and the strong-tier skill runs (and the
 * `trending_refresh` event logs) only once, not once per caller. A call made
 * AFTER the shared run has settled starts a fresh run (so the manual Refresh
 * button still works). Note: the shared run uses only the FIRST caller's
 * `opts` — a second concurrent caller's opts are ignored. This is safe today
 * because both call sites (home auto-refresh, /trending mount) derive
 * identical effective fields from the same trending settings; if a future
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
  const perDiscipline: DisciplineBuckets[] = []
  for (const anchor of anchors) {
    opts.onProgress?.(anchor.label)
    try {
      const recent = await opts.topicGroupFn({ query: anchor.label, ...windows.recent })
      perDiscipline.push({ discipline: anchor.label, recent })
    } catch (err) {
      console.warn(`[trending] topic grouping failed for "${anchor.label}":`, err)
    }
  }
  const priorCounts = await lookupPriorCounts(opts, perDiscipline, windows.prior)
  const ranked = rankHeatingTopics(perDiscipline, priorCounts)
  const totalRecent = await countRecentWorks(opts, perDiscipline, windows.recent)

  // --- Per-topic enrichment (representative papers) ---------------------------
  // Sequential on purpose: at most MAX_LEADERBOARD_TOPICS topics, and OpenAlex
  // is credit-priced and rate-limited — bounded, predictable load beats speed.
  const enriched: Array<{ topic: RankedTopic; papers: PaperRecord[] }> = []
  for (const topic of ranked) {
    const papers = await searchTopicPapers(opts, topic.label, windows.recent.fromDate)
    enriched.push({ topic, papers })
  }

  // --- Deterministic breakouts (recent, citation-ranked, across the anchors) --
  const breakoutRecords = await retrieveBreakouts(opts, anchors, at)

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
    // The lens is pure, but it walks user-editable frontmatter (tags) and
    // source-supplied titles; one malformed page must not blank the board, so
    // a throw degrades this row to "not relevant, no links" instead.
    let lens = { relevant: false, wikiPageIds: [] as string[] }
    try {
      lens = topicLens({ label: topic.label, papers }, interestLabels, bundle)
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
    }
  }
  return priorCounts
}

/**
 * "New papers this window" across the anchor disciplines. Uses one real
 * `countFn` call per anchor over the complete recent window rather than summing
 * the `group_by` buckets we already have: group_by is capped at 200 groups, so
 * summing it silently truncates the long tail and understates the total — and
 * SP4's premise is that every displayed figure is a real count.
 *
 * CAVEAT (carried into the UI label): a work matching two anchors' searches is
 * counted once per anchor, so overlapping disciplines can double-count. If a
 * count fails, that anchor falls back to the summed buckets — a low-but-honest
 * number beats a missing figure.
 */
async function countRecentWorks(
  opts: RunTrendingBoardOpts,
  perDiscipline: DisciplineBuckets[],
  recentWindow: { fromDate: string; toDate: string },
): Promise<number> {
  let total = 0
  for (const { discipline, recent } of perDiscipline) {
    const bucketSum = recent.reduce((s, entry) => s + entry.count, 0)
    try {
      total += await opts.countFn({ query: discipline, ...recentWindow })
    } catch (err) {
      console.warn(`[trending] recent-work count failed for "${discipline}":`, err)
      total += bucketSum
    }
  }
  return total
}

/** `[]` on any failure — the expanded row shows text only. */
async function searchTopicPapers(
  opts: RunTrendingBoardOpts,
  label: string,
  fromDate: string,
): Promise<PaperRecord[]> {
  try {
    return (await opts.searchFn("openalex", label, MAX_TOPIC_PAPERS, { fromDate })).slice(0, MAX_TOPIC_PAPERS)
  } catch (err) {
    console.warn(`[trending] representative-paper search failed for "${label}":`, err)
    return []
  }
}

/**
 * Breakout papers: RECENT papers with unusual citation counts — one retrieval
 * pass per anchor discipline, merged and deduped, ranked by citations.
 *
 * `candidates.movers` is the whole undated sample sorted by citations, so
 * ranking it directly would surface the same field classics on every refresh
 * forever ("recent papers with unusual citation velocity" would be a false
 * label). Movers are therefore intersected with `candidates.recent` — the same
 * retrieval, no extra requests — and an empty strip is an acceptable, honest
 * outcome (the component renders nothing).
 */
async function retrieveBreakouts(
  opts: RunTrendingBoardOpts,
  anchors: AnchorDiscipline[],
  at: Date,
): Promise<PaperRecord[]> {
  const merged = new Map<string, PaperRecord>()
  for (const anchor of anchors) {
    try {
      const candidates = await retrieveFieldCandidates(opts.searchFn, { slug: anchor.id, label: anchor.label }, { now: at })
      const recentKeys = new Set(candidates.recent.map((r) => paperKey(r)))
      for (const record of candidates.movers) {
        if (!recentKeys.has(paperKey(record))) continue
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
