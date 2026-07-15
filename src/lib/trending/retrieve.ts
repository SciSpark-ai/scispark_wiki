import type { PaperRecord, SourceId } from "../papers/types"
import { paperKey, mergeRecords } from "../papers/types"
import type { SearchFn } from "../skills/feed"
import type { TrackedField } from "./fields"
import { paperDate } from "./paper-date"

export interface TrendingCandidates {
  /** Papers published within the recent window (for volume/counts). */
  recent: PaperRecord[]
  /** Field papers ranked by citationCount desc (for "top movers"). */
  movers: PaperRecord[]
}

// Keyless-safe sources (arxiv + openalex need no API key), same default as
// M9 grounding/scoop. s2/pubmed rate-limit hard when keyless.
const SOURCES: readonly SourceId[] = ["arxiv", "openalex"]
const DEFAULT_RECENT_WINDOW_DAYS = 14
const DEFAULT_LIMIT = 25

function dedupe(records: PaperRecord[]): PaperRecord[] {
  const merged = new Map<string, PaperRecord>()
  const order: string[] = []
  for (const r of records) {
    const key = paperKey(r)
    const existing = merged.get(key)
    if (existing) merged.set(key, mergeRecords(existing, r))
    else {
      merged.set(key, r)
      order.push(key)
    }
  }
  return order.map((k) => merged.get(k)!).filter(Boolean)
}

/**
 * Retrieves candidate papers for a field: `recent` (published within the
 * window) and `movers` (citation-sorted). Runs both queries over the keyless
 * sources concurrently; a failed source contributes []. Pure w.r.t. storage —
 * `searchFn` is injected (a `SearchFn` implementation in the app, a node searchFn in tests).
 */
export async function retrieveFieldCandidates(
  searchFn: SearchFn,
  field: TrackedField,
  opts: { now: Date; recentWindowDays?: number; limit?: number },
): Promise<TrendingCandidates> {
  const windowDays = opts.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS
  const limit = opts.limit ?? DEFAULT_LIMIT
  const cutoff = new Date(opts.now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  const perSource = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        return await searchFn(source, field.label, limit)
      } catch {
        return []
      }
    }),
  )
  const all = dedupe(perSource.flat())

  const recent = all.filter((p) => {
    const d = paperDate(p)
    return d !== null && d.getTime() >= cutoff.getTime()
  })
  const movers = [...all].sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))

  return { recent, movers }
}
