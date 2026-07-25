import type { GroupEntry } from "../papers/openalex"
import { isoWeekStart } from "./weeks"

const DAY_MS = 24 * 60 * 60 * 1000

/** How many complete ISO weeks each window (recent/prior) spans. */
export const WINDOW_WEEKS = 2

/** A topic must clear this many recent-window works to make the leaderboard at all. */
export const MIN_RECENT_COUNT = 5

/** Upper bound on how many topics the leaderboard returns. */
export const MAX_LEADERBOARD_TOPICS = 10

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

export interface RankedTopic {
  key: string
  label: string
  discipline: string // AnchorDiscipline.label
  recentCount: number
  priorCount: number
  growth: number | null // null when priorCount === 0 → "new"
}

/**
 * Joins recent↔prior GroupEntry lists by topic `key` per discipline, drops
 * topics under the volume floor, computes growth, merges all disciplines
 * into one leaderboard, and sorts fastest-growing first (`null` growth —
 * genuinely new topics — ranks as the largest value), tie-broken by
 * recentCount desc then label asc, capped at MAX_LEADERBOARD_TOPICS.
 */
export function rankHeatingTopics(
  perDiscipline: Array<{ discipline: string; recent: GroupEntry[]; prior: GroupEntry[] }>,
): RankedTopic[] {
  const byKey = new Map<string, RankedTopic>()

  for (const { discipline, recent, prior } of perDiscipline) {
    const priorByKey = new Map(prior.map((p) => [p.key, p.count]))

    for (const r of recent) {
      if (r.count < MIN_RECENT_COUNT) continue

      const priorCount = priorByKey.get(r.key) ?? 0
      const growth = priorCount === 0 ? null : (r.count - priorCount) / priorCount

      const candidate: RankedTopic = {
        key: r.key,
        label: r.label,
        discipline,
        recentCount: r.count,
        priorCount,
        growth,
      }

      const existing = byKey.get(r.key)
      if (!existing || candidate.recentCount > existing.recentCount) {
        byKey.set(r.key, candidate)
      }
    }
  }

  const all = Array.from(byKey.values())
  all.sort((a, b) => {
    const growthCmp = compareGrowthDesc(a.growth, b.growth)
    if (growthCmp !== 0) return growthCmp
    if (b.recentCount !== a.recentCount) return b.recentCount - a.recentCount
    return a.label.localeCompare(b.label)
  })

  return all.slice(0, MAX_LEADERBOARD_TOPICS)
}

/** Descending growth comparator treating `null` as the largest value. */
function compareGrowthDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return -1
  if (b === null) return 1
  return b - a
}
