import type { PaperRecord } from "../papers/types"
import type { TrendingCandidates } from "./retrieve"
import { paperDate } from "./paper-date"
import { isoWeekStart, buildWeekStarts } from "./weeks"

export interface VolumePoint {
  /** ISO date (YYYY-MM-DD) of the week's Monday, UTC. */
  weekStart: string
  count: number
}

export interface FieldMetrics {
  paperCountRecent: number
  paperCountPrior: number
  /** (recent - prior) / prior; null when prior === 0. */
  pctChange: number | null
  /** Fixed-length weekly volume series, oldest → newest, zero-filled. */
  weeklyVolume: VolumePoint[]
  topMovers: Array<{ paper: PaperRecord; citationCount: number }>
  topVenues: Array<{ venue: string; count: number }>
}

const DEFAULT_RECENT_WINDOW_DAYS = 14
export const DEFAULT_WEEKS = 8
const TOP_MOVERS = 5
const TOP_VENUES = 5
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Computes field-level trending metrics from candidates already retrieved by
 * `retrieveFieldCandidates`.
 *
 * IMPORTANT: `opts.now` and `opts.recentWindowDays` here MUST be the exact
 * same values passed to `retrieveFieldCandidates` for this `candidates`
 * object. `paperCountRecent` is derived from `candidates.recent`, which was
 * already filtered by `retrieveFieldCandidates` using its own now/window;
 * `paperCountPrior` (and therefore `pctChange`) is computed here by
 * re-deriving cutoffs from `opts.now`/`opts.recentWindowDays`. If the two
 * calls disagree, the recent and prior windows silently desynchronize
 * (gaps, overlaps, or double-counted papers) without any error.
 *
 * `opts.realWeeklyVolume`, when present, is a real per-week series (from
 * `fetchWeeklyVolume`) that REPLACES the sample-derived weeklyVolume AND the
 * recent/prior/pctChange math: `weeklyVolume` becomes that series verbatim,
 * `paperCountRecent`/`paperCountPrior` become sums of its last-2/prior-2
 * buckets (week-aligned, not day-window-aligned), and `pctChange` is derived
 * from those. `topMovers`/`topVenues` are unaffected either way — they always
 * come from `candidates.movers` (the retrieval sample), since real per-week
 * counts carry no per-paper detail to rank by.
 */
export function computeFieldMetrics(
  candidates: TrendingCandidates,
  opts: { now: Date; recentWindowDays?: number; weeks?: number; realWeeklyVolume?: VolumePoint[] },
): FieldMetrics {
  const windowDays = opts.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS
  const weeks = opts.weeks ?? DEFAULT_WEEKS

  let paperCountRecent: number
  let paperCountPrior: number
  let pctChange: number | null
  let weeklyVolume: VolumePoint[]

  if (opts.realWeeklyVolume) {
    // Real per-week series: use it verbatim and derive recent/prior from its
    // own buckets (week-aligned) rather than re-deriving day-based cutoffs.
    // `.slice()` on a shorter-than-4-bucket array naturally yields fewer (or
    // zero) elements, so missing older weeks sum to 0 with no special-casing.
    weeklyVolume = opts.realWeeklyVolume
    const counts = weeklyVolume.map((v) => v.count)
    paperCountRecent = counts.slice(-2).reduce((a, b) => a + b, 0)
    paperCountPrior = counts.slice(-4, -2).reduce((a, b) => a + b, 0)
    pctChange = paperCountPrior === 0 ? null : (paperCountRecent - paperCountPrior) / paperCountPrior
  } else {
    const recentCutoff = opts.now.getTime() - windowDays * DAY_MS
    const priorCutoff = opts.now.getTime() - 2 * windowDays * DAY_MS

    paperCountRecent = candidates.recent.length

    // Prior window count comes from movers (the full field set), which
    // includes papers outside the recent window.
    paperCountPrior = 0
    for (const p of candidates.movers) {
      const d = paperDate(p)
      if (d === null) continue
      const t = d.getTime()
      if (t >= priorCutoff && t < recentCutoff) paperCountPrior++
    }
    pctChange = paperCountPrior === 0 ? null : (paperCountRecent - paperCountPrior) / paperCountPrior

    // Weekly volume: fixed-length, zero-filled series ending at the current week.
    const weekStarts = buildWeekStarts(opts.now, weeks)
    const buckets = new Map<string, number>()
    for (const ws of weekStarts) buckets.set(ws, 0)
    for (const p of candidates.movers) {
      const d = paperDate(p)
      if (d === null) continue
      const ws = isoWeekStart(d)
      if (buckets.has(ws)) buckets.set(ws, (buckets.get(ws) ?? 0) + 1)
    }
    weeklyVolume = weekStarts.map((ws) => ({ weekStart: ws, count: buckets.get(ws) ?? 0 }))
  }

  // Defensive re-sort: don't rely on the producer (retrieveFieldCandidates)
  // having sorted movers by citationCount already. For already-sorted input
  // this is a no-op (stable sort preserves order among equal counts).
  const sortedMovers = [...candidates.movers].sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
  const topMovers = sortedMovers
    .filter((p): p is PaperRecord & { citationCount: number } => typeof p.citationCount === "number")
    .slice(0, TOP_MOVERS)
    .map((p) => ({ paper: p, citationCount: p.citationCount }))

  const venueCounts = new Map<string, number>()
  for (const p of candidates.movers) {
    const v = p.venue?.trim()
    if (v) venueCounts.set(v, (venueCounts.get(v) ?? 0) + 1)
  }
  const topVenues = [...venueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VENUES)
    .map(([venue, count]) => ({ venue, count }))

  return { paperCountRecent, paperCountPrior, pctChange, weeklyVolume, topMovers, topVenues }
}
