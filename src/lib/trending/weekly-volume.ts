import type { VolumePoint } from "./metrics"
import { isoWeekStart } from "./weeks"

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CONCURRENCY = 4

export type CountFn = (q: { query: string; fromDate: string; toDate: string }) => Promise<number>

/**
 * One group_by=publication_date OpenAlex request (1 credit) covering an
 * entire date range, returning daily {key: "YYYY-MM-DD", count} buckets.
 * fetchWeeklyVolume sums these into ISO-week buckets instead of issuing one
 * countFn call per week (8 requests x 10 credits for the default window).
 */
export type GroupFn = (q: { query: string; fromDate: string; toDate: string }) => Promise<Array<{ key: string; count: number }>>

// Copied from src/lib/spark/scoop.ts's createLimiter (not exported there) — a minimal
// FIFO concurrency limiter: at most `maxConcurrent` tasks run at once, the rest queue.
function createLimiter(maxConcurrent: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: Array<() => void> = []
  const pump = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const start = queue.shift()!
      active++
      start()
    }
  }
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => {
          active--
          pump()
        })
      })
      pump()
    })
}

/** Inclusive Sunday end (YYYY-MM-DD, UTC) for the Mon..Sun week starting at `weekStart`. */
function weekEnd(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00.000Z`)
  return new Date(start.getTime() + 6 * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Tries ONE grouped OpenAlex request spanning the whole [weekStarts[0], last
 * weekStart + 6d] window and sums its daily buckets into `weekStarts`-aligned
 * ISO-week counts (zero-filled). A daily key outside the requested window is
 * ignored (defensive — OpenAlex's filter should already exclude it).
 *
 * Returns `null` (the "use the per-week countFn fallback" signal) when
 * `groupFn` throws OR returns an empty/unusable array. Empty is deliberately
 * treated as unusable even though a legitimately all-zero window would also
 * return no groups: group_by omits zero-count buckets entirely, so an empty
 * response is indistinguishable from a transient/malformed one, and the
 * countFn fallback path already zero-fills correctly either way — so falling
 * back costs nothing in the genuinely-empty case and recovers correctly in
 * the malformed-response case.
 */
async function fetchGroupedWeeklyVolume(
  groupFn: GroupFn,
  query: string,
  weekStarts: string[],
): Promise<VolumePoint[] | null> {
  if (weekStarts.length === 0) return null
  try {
    const fromDate = weekStarts[0]
    const toDate = weekEnd(weekStarts[weekStarts.length - 1])
    const groups = await groupFn({ query, fromDate, toDate })
    if (!Array.isArray(groups) || groups.length === 0) return null

    const buckets = new Map<string, number>(weekStarts.map((weekStart) => [weekStart, 0]))
    for (const g of groups) {
      if (g == null || typeof g.key !== "string" || typeof g.count !== "number") continue
      const day = g.key.slice(0, 10) // tolerate keys with a trailing time suffix
      const parsed = new Date(`${day}T00:00:00.000Z`)
      if (Number.isNaN(parsed.getTime())) continue
      const weekStart = isoWeekStart(parsed)
      if (!buckets.has(weekStart)) continue // outside the requested window — ignored
      buckets.set(weekStart, (buckets.get(weekStart) ?? 0) + g.count)
    }
    return weekStarts.map((weekStart) => ({ weekStart, count: buckets.get(weekStart) ?? 0 }))
  } catch {
    return null
  }
}

/**
 * Fetches a real per-week volume count for `query` across `weekStarts` (each an ISO
 * Monday). When `groupFn` is supplied, tries ONE grouped request first (1 OpenAlex
 * credit — see `fetchGroupedWeeklyVolume`); on success returns immediately. Otherwise
 * (no `groupFn`, or the grouped attempt was unusable) falls back to the original
 * per-week path: one `countFn` call per week, throttled to at most `MAX_CONCURRENCY`
 * concurrent calls. Returns `VolumePoint[]` aligned 1:1 with `weekStarts` (same order),
 * or `null` if any single week's count throws (the fallback signal — caller should fall
 * back to a cached/derived series rather than show a partial one).
 */
export async function fetchWeeklyVolume(
  countFn: CountFn,
  query: string,
  weekStarts: string[],
  groupFn?: GroupFn,
): Promise<VolumePoint[] | null> {
  if (groupFn) {
    const grouped = await fetchGroupedWeeklyVolume(groupFn, query, weekStarts)
    if (grouped) return grouped
  }

  const limit = createLimiter(MAX_CONCURRENCY)
  try {
    const counts = await Promise.all(
      weekStarts.map((weekStart) =>
        limit(() => countFn({ query, fromDate: weekStart, toDate: weekEnd(weekStart) })),
      ),
    )
    return weekStarts.map((weekStart, i) => ({ weekStart, count: counts[i] }))
  } catch {
    return null
  }
}
