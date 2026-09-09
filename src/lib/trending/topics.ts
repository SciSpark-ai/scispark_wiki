import type { GroupEntry } from "../papers/openalex"
import { isoWeekStart } from "./weeks"

const DAY_MS = 24 * 60 * 60 * 1000

/** How many complete ISO weeks each window (recent/prior) spans. Module-local:
 * the window shape is `completeWindows`' business, and nothing outside this file
 * has ever needed the number. */
const WINDOW_WEEKS = 2

/** A topic must clear this many recent-window works to make the leaderboard at all. */
export const MIN_RECENT_COUNT = 5

/**
 * The smallest PRIOR count worth dividing by — the symmetric half of
 * MIN_RECENT_COUNT, defined once so the two bars can never drift apart.
 *
 * Without it the floor guarded only the numerator's window: a topic going
 * 1 → 5 works clears MIN_RECENT_COUNT and posts a precise-looking +400% share
 * figure computed off a denominator that is pure noise, then tops a board whose
 * whole claim is "these are the topics heating up".
 *
 * It is a RANKING rule, not a visibility rule: a row below this bar is shown as
 * "new" (`growth: null`), exactly like a measured zero prior — never dropped.
 * Dropping it made the ladder non-monotonic (prior 0 visible, prior 1–4 gone,
 * prior ≥5 visible), so a genuine 2 → 40 breakout — precisely what this page
 * exists to surface — vanished with no `dataError` to explain it, because
 * nothing had actually failed. "Too small a base to quote a percentage from"
 * and "no base at all" are the same statement to a reader, and both are honest;
 * the absolute counts are still carried on the row either way.
 */
export const MIN_PRIOR_COUNT = MIN_RECENT_COUNT

/** Upper bound on how many topics the leaderboard returns. */
export const MAX_LEADERBOARD_TOPICS = 10

/**
 * How many recent-window topics get a prior-count lookup (one OpenAlex credit
 * each — see `selectTopicCandidates`). The pool is deliberately bounded: a
 * low-volume topic that would have posted spectacular growth but sits outside
 * the top CANDIDATE_POOL by RECENT count is out of reach by design. Widening
 * the pool costs one request per extra candidate on every refresh, and the
 * board only ever shows MAX_LEADERBOARD_TOPICS rows, so 2x headroom buys most
 * of the reachable growth for a predictable, quota-safe price.
 */
export const CANDIDATE_POOL = 20

export interface DateWindow {
  fromDate: string
  toDate: string
}

/**
 * Recent = the last WINDOW_WEEKS complete ISO weeks; prior = the
 * WINDOW_WEEKS before those. The in-progress week (the one containing
 * `now`) is excluded from both: `isoWeekStart(now)` is its Monday, which is
 * the exclusive upper bound, so `recent.toDate` is the day before it.
 */
export function completeWindows(now: Date): { recent: DateWindow; prior: DateWindow } {
  const inProgressWeekStart = new Date(`${isoWeekStart(now)}T00:00:00.000Z`)
  const windowMs = WINDOW_WEEKS * 7 * DAY_MS

  const recentTo = new Date(inProgressWeekStart.getTime() - DAY_MS)
  const recentFrom = new Date(inProgressWeekStart.getTime() - windowMs)
  const priorTo = new Date(recentFrom.getTime() - DAY_MS)
  const priorFrom = new Date(recentFrom.getTime() - windowMs)

  return {
    recent: { fromDate: toIsoDate(recentFrom), toDate: toIsoDate(recentTo) },
    prior: { fromDate: toIsoDate(priorFrom), toDate: toIsoDate(priorTo) },
  }
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

interface DateParts {
  year: number
  month: number
  day: number
}

function dateParts(iso: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  return { year, month, day }
}

/** Compact, deterministic UTC label for an inclusive date window. */
export function formatDateWindow(window: DateWindow): string | null {
  const from = dateParts(window.fromDate)
  const to = dateParts(window.toDate)
  if (!from || !to) return null

  const fromMonth = MONTH_NAMES[from.month - 1]
  const toMonth = MONTH_NAMES[to.month - 1]
  if (from.year === to.year && from.month === to.month) {
    return `${fromMonth} ${from.day}–${to.day}, ${to.year}`
  }
  if (from.year === to.year) {
    return `${fromMonth} ${from.day}–${toMonth} ${to.day}, ${to.year}`
  }
  return `${fromMonth} ${from.day}, ${from.year}–${toMonth} ${to.day}, ${to.year}`
}

/**
 * Reconstructs the exact two comparison ranges used by a cached board. Older
 * v4 caches did not persist the ranges, but `generatedAt` plus the complete
 * ISO-week rule determines them exactly.
 */
export function trendingWindowLabels(generatedAt: string): { recent: string; prior: string } {
  const at = new Date(generatedAt)
  if (Number.isNaN(at.getTime())) {
    return {
      recent: "the latest complete two-week period",
      prior: "the preceding complete two-week period",
    }
  }
  const windows = completeWindows(at)
  return {
    recent: formatDateWindow(windows.recent) ?? "the latest complete two-week period",
    prior: formatDateWindow(windows.prior) ?? "the preceding complete two-week period",
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** One anchor discipline's RECENT-window `group_by=primary_topic.id` buckets. */
export interface DisciplineBuckets {
  discipline: string // AnchorDiscipline.label
  recent: GroupEntry[]
}

/** A recent-window topic that qualifies for a prior-count lookup. Module-local:
 * callers consume `RankedTopic` (which extends it) or the `TopicCandidate[]`
 * `selectTopicCandidates` returns; nothing imports the name itself. */
interface TopicCandidate {
  key: string
  label: string
  discipline: string
  recentCount: number
}

/**
 * One anchor discipline's measured corpus size in each window — the count of
 * ALL works matching the discipline search over that window, unscoped by topic.
 * `null` means the count request failed, i.e. the size is UNKNOWN (never 0).
 */
export interface CorpusTotals {
  recent: number | null
  prior: number | null
}

export interface RankedTopic extends TopicCandidate {
  priorCount: number
  /** `recentCount / corpus recent total` — the topic's slice of its discipline. */
  recentShare: number
  /** `priorCount / corpus prior total`; exactly 0 for a "new" row (priorCount below MIN_PRIOR_COUNT). */
  priorShare: number
  /** (recentShare − priorShare) / priorShare; null when priorCount < MIN_PRIOR_COUNT → "new". */
  growth: number | null
}

/**
 * Merges every discipline's recent buckets into one candidate list: drops
 * topics under the volume floor, dedupes a topic appearing under two
 * disciplines (keeping the higher recent count, so a row is attributed to the
 * discipline it is actually big in), and orders by recentCount desc, label asc.
 */
function mergeRecentBuckets(perDiscipline: DisciplineBuckets[]): TopicCandidate[] {
  const byKey = new Map<string, TopicCandidate>()

  for (const { discipline, recent } of perDiscipline) {
    for (const r of recent) {
      if (r.count < MIN_RECENT_COUNT) continue
      const candidate: TopicCandidate = { key: r.key, label: r.label, discipline, recentCount: r.count }
      const existing = byKey.get(r.key)
      if (!existing || candidate.recentCount > existing.recentCount) byKey.set(r.key, candidate)
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (b.recentCount !== a.recentCount) return b.recentCount - a.recentCount
    return a.label.localeCompare(b.label)
  })
}

/**
 * The bounded set of topics whose PRIOR count is worth one OpenAlex credit
 * each (see `rankHeatingTopics` for why a prior count must be looked up rather
 * than read off a second grouped list).
 *
 * TRADEOFF, deliberate: candidates are chosen by RECENT volume, so a
 * low-volume topic that happens to be growing explosively — say 6 papers up
 * from 1 — never gets a prior lookup if it sits outside the top
 * CANDIDATE_POOL, and therefore can never reach the board. Ranking by growth
 * would require knowing the growth, which is exactly what the lookups buy;
 * the only alternative is a lookup for every bucket (up to 200 per anchor,
 * blowing the OpenAlex daily quota on a single refresh).
 */
export function selectTopicCandidates(perDiscipline: DisciplineBuckets[]): TopicCandidate[] {
  return mergeRecentBuckets(perDiscipline).slice(0, CANDIDATE_POOL)
}

/**
 * Ranks the leaderboard from each discipline's recent buckets plus a map of
 * TRUE prior counts (keyed by topic key), as measured by one filtered count
 * request per candidate.
 *
 * Prior counts are an INPUT, never inferred from a second `group_by` list:
 * OpenAlex caps a grouped response at 200 buckets, and the recent and prior
 * windows have different visibility thresholds (measured live on Computer
 * Science, 2026-07-25: the recent list's 200th bucket held 14 works, the
 * prior list's held 22 — older papers are indexed more completely). A
 * mid-sized topic therefore clears the recent bar while falling off the prior
 * list, and a join between the two lists reads that absence as `priorCount:
 * 0`. That produced `growth: null` → rendered "new" → sorted first, filling
 * the whole board with artifacts (60 of 200 topics affected, all in the 14–27
 * recent-count band, and one-directional: the bug could manufacture a "new"
 * topic but never a decline).
 *
 * A candidate with NO entry in `priorCounts` is dropped from the ranking
 * rather than defaulted to 0 — an unmeasured prior is unknown, not zero. So
 * `growth: null` now means a measured prior too small to divide by (zero, or
 * below MIN_PRIOR_COUNT), and "new" is trustworthy;
 * null therefore still sorts first, which is now correct.
 *
 * GROWTH IS A RATIO OF SHARES, NOT OF RAW COUNTS. OpenAlex back-fills recent
 * publication dates for weeks, so the most recent complete fortnight is only
 * partially indexed when we read it. Measured live 2026-07-25, per discipline:
 *
 *   Computer Science  window(-3) 16624 → prior 22808 → recent 13953
 *   Neuroscience      window(-3)  4251 → prior  5881 → recent  4036
 *
 * The MIDDLE window is the highest in both, so this is indexing lag, not a
 * real slump: the recent window is only ~61%/69% indexed. Ranking raw counts
 * therefore hands every topic the same ~39% headwind, and the live board came
 * back 8-of-10 negative on a page whose whole premise is "what is heating up".
 * The lag applies near-uniformly to every topic inside a discipline, so it
 * CANCELS in a ratio of shares:
 *
 *   growth = (recentCount/totalRecent − priorCount/totalPrior) / (priorCount/totalPrior)
 *
 * On tonight's real CS numbers, "Multimodal Machine Learning" 184 → 134 is
 * −27% raw but +19% by share, and "Complexity and Algorithms in Graphs"
 * 39 → 60 is +54% raw but +151% by share. Both are correct here.
 *
 * The volume floors (MIN_RECENT_COUNT, MIN_PRIOR_COUNT) still apply to the RAW
 * counts on BOTH sides — a share floor would mean nothing across disciplines of
 * different sizes — and both raw counts are carried through for honest absolute
 * volume. A nonzero prior below MIN_PRIOR_COUNT is not dropped but ranked as
 * "new": dividing by it would manufacture a chart-topping percentage out of
 * noise, while dropping it would hide a real 2 → 40 breakout behind a threshold
 * no one is told about.
 *
 * A discipline whose corpus size was NOT measured (`null`, i.e. its count
 * request failed) cannot produce a share, so its rows are DROPPED rather than
 * silently falling back to raw-count growth — mixing the two would make the
 * ranking incomparable and reintroduce exactly the artifact above. The prior
 * total is only needed by rows that actually divide by it: a row under
 * MIN_PRIOR_COUNT (including a measured zero) is "new" with `priorShare: 0`, no
 * division and no `NaN`/`Infinity` — and a genuinely empty prior corpus (`totalPrior: 0`)
 * can only produce such rows, so it needs no special case either.
 *
 * Sorted fastest-growing first, tie-broken by RAW recentCount desc then label
 * asc, capped at MAX_LEADERBOARD_TOPICS.
 */
export function rankHeatingTopics(
  perDiscipline: DisciplineBuckets[],
  priorCounts: Map<string, number>,
  corpusTotals: Map<string, CorpusTotals>,
): RankedTopic[] {
  const ranked: RankedTopic[] = []

  for (const candidate of mergeRecentBuckets(perDiscipline)) {
    const priorCount = priorCounts.get(candidate.key)
    if (priorCount === undefined) continue

    const totals = corpusTotals.get(candidate.discipline)
    const totalRecent = totals?.recent
    if (!isMeasuredSize(totalRecent)) continue
    const recentShare = candidate.recentCount / totalRecent

    // "New": a measured zero prior, or a base too small to quote a percentage
    // from (see MIN_PRIOR_COUNT). Both take the same exit — growth null, an
    // empty prior bar, and the raw priorCount carried through as text — so the
    // ladder is monotonic in prior volume: small base → "new", sufficient base
    // → a real figure. Neither divides, so neither can produce NaN/Infinity or
    // a noise-driven percentage, and neither needs the prior corpus total.
    if (priorCount < MIN_PRIOR_COUNT) {
      ranked.push({ ...candidate, priorCount, recentShare, priorShare: 0, growth: null })
      continue
    }

    const totalPrior = totals?.prior
    if (!isMeasuredSize(totalPrior)) continue
    const priorShare = priorCount / totalPrior

    ranked.push({
      ...candidate,
      priorCount,
      recentShare,
      priorShare,
      growth: (recentShare - priorShare) / priorShare,
    })
  }

  ranked.sort((a, b) => {
    const growthCmp = compareGrowthDesc(a.growth, b.growth)
    if (growthCmp !== 0) return growthCmp
    if (b.recentCount !== a.recentCount) return b.recentCount - a.recentCount
    return a.label.localeCompare(b.label)
  })

  return ranked.slice(0, MAX_LEADERBOARD_TOPICS)
}

/**
 * A corpus size usable as a share denominator: really measured, finite and
 * positive. A missing/failed count is `null` (unknown, not zero), and a
 * non-positive or non-finite one is malformed — either way, dividing by it
 * would put `Infinity`/`NaN` on the board.
 */
function isMeasuredSize(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
}

/** Descending growth comparator treating `null` as the largest value. */
function compareGrowthDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  return b - a
}
