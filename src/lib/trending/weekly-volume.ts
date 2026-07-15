import type { VolumePoint } from "./metrics"

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CONCURRENCY = 4

export type CountFn = (q: { query: string; fromDate: string; toDate: string }) => Promise<number>

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
 * Fetches a real per-week volume count for `query` across `weekStarts` (each an ISO
 * Monday), throttled to at most `MAX_CONCURRENCY` concurrent `countFn` calls. Returns
 * `VolumePoint[]` aligned 1:1 with `weekStarts` (same order), or `null` if any single
 * week's count throws (the fallback signal — caller should fall back to a cached/derived
 * series rather than show a partial one).
 */
export async function fetchWeeklyVolume(
  countFn: CountFn,
  query: string,
  weekStarts: string[],
): Promise<VolumePoint[] | null> {
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
