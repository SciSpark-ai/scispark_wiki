import type { GroupEntry } from "../papers/openalex"
import { isoWeekStart } from "./weeks"

const DAY_MS = 24 * 60 * 60 * 1000

/** How many complete ISO weeks each window (recent/prior) spans. */
export const WINDOW_WEEKS = 2

/** A topic must clear this many recent-window works to make the leaderboard at all. */
export const MIN_RECENT_COUNT = 5

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

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** One anchor discipline's RECENT-window `group_by=primary_topic.id` buckets. */
export interface DisciplineBuckets {
  discipline: string // AnchorDiscipline.label
  recent: GroupEntry[]
}

/** A recent-window topic that qualifies for a prior-count lookup. */
export interface TopicCandidate {
  key: string
  label: string
  discipline: string
  recentCount: number
}

export interface RankedTopic extends TopicCandidate {
  priorCount: number
  growth: number | null // null when priorCount === 0 → genuinely "new"
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
 * `growth: null` now means a genuine zero prior, and "new" is trustworthy;
 * null therefore still sorts first, which is now correct.
 *
 * Sorted fastest-growing first, tie-broken by recentCount desc then label
 * asc, capped at MAX_LEADERBOARD_TOPICS.
 */
export function rankHeatingTopics(
  perDiscipline: DisciplineBuckets[],
  priorCounts: Map<string, number>,
): RankedTopic[] {
  const ranked: RankedTopic[] = []

  for (const candidate of mergeRecentBuckets(perDiscipline)) {
    const priorCount = priorCounts.get(candidate.key)
    if (priorCount === undefined) continue
    ranked.push({
      ...candidate,
      priorCount,
      growth: priorCount === 0 ? null : (candidate.recentCount - priorCount) / priorCount,
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

/** Descending growth comparator treating `null` as the largest value. */
function compareGrowthDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  return b - a
}
