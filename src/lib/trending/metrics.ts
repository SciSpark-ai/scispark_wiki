import type { PaperRecord } from "../papers/types"
import type { TrendingCandidates } from "./retrieve"

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
const DEFAULT_WEEKS = 8
const TOP_MOVERS = 5
const TOP_VENUES = 5
const DAY_MS = 24 * 60 * 60 * 1000

function paperDate(p: PaperRecord): Date | null {
  if (p.date) {
    const d = new Date(p.date)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (p.year !== undefined) return new Date(Date.UTC(p.year, 0, 1))
  return null
}

/** UTC Monday of the week containing `d`, as a YYYY-MM-DD string. */
function isoWeekStart(d: Date): string {
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const deltaToMonday = (day + 6) % 7 // Mon→0, Sun→6
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - deltaToMonday))
  return monday.toISOString().slice(0, 10)
}

export function computeFieldMetrics(
  candidates: TrendingCandidates,
  opts: { now: Date; recentWindowDays?: number; weeks?: number },
): FieldMetrics {
  const windowDays = opts.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS
  const weeks = opts.weeks ?? DEFAULT_WEEKS
  const recentCutoff = opts.now.getTime() - windowDays * DAY_MS
  const priorCutoff = opts.now.getTime() - 2 * windowDays * DAY_MS

  const paperCountRecent = candidates.recent.length

  // Prior window count comes from movers (the full field set), which includes
  // papers outside the recent window.
  let paperCountPrior = 0
  for (const p of candidates.movers) {
    const d = paperDate(p)
    if (d === null) continue
    const t = d.getTime()
    if (t >= priorCutoff && t < recentCutoff) paperCountPrior++
  }
  const pctChange = paperCountPrior === 0 ? null : (paperCountRecent - paperCountPrior) / paperCountPrior

  // Weekly volume: fixed-length, zero-filled series ending at the current week.
  const thisWeekStart = isoWeekStart(opts.now)
  const buckets = new Map<string, number>()
  const weekStarts: string[] = []
  const anchor = new Date(`${thisWeekStart}T00:00:00.000Z`)
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(anchor.getTime() - i * 7 * DAY_MS).toISOString().slice(0, 10)
    weekStarts.push(ws)
    buckets.set(ws, 0)
  }
  for (const p of candidates.movers) {
    const d = paperDate(p)
    if (d === null) continue
    const ws = isoWeekStart(d)
    if (buckets.has(ws)) buckets.set(ws, (buckets.get(ws) ?? 0) + 1)
  }
  const weeklyVolume: VolumePoint[] = weekStarts.map((ws) => ({ weekStart: ws, count: buckets.get(ws) ?? 0 }))

  const topMovers = candidates.movers
    .filter((p): p is PaperRecord & { citationCount: number } => typeof p.citationCount === "number")
    .slice(0, TOP_MOVERS)
    .map((p) => ({ paper: p, citationCount: p.citationCount }))

  const venueCounts = new Map<string, number>()
  for (const p of candidates.movers) {
    if (p.venue && p.venue.trim().length > 0) venueCounts.set(p.venue, (venueCounts.get(p.venue) ?? 0) + 1)
  }
  const topVenues = [...venueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VENUES)
    .map(([venue, count]) => ({ venue, count }))

  return { paperCountRecent, paperCountPrior, pctChange, weeklyVolume, topMovers, topVenues }
}
