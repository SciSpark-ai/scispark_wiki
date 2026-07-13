import type { TimelineLane } from "./timeline"
import type { AuthorNode } from "./authors"

// Synthetic lane id for the merged overflow row `topLanes` produces when
// there are more lanes than the requested top-N.
export const OTHER_LANE_ID = "__other__"
const OTHER_LANE_TITLE = "Other"

/**
 * Top `n` lanes by `itemCount` (ties broken by title, same order
 * `deriveTimeline` already sorts in) plus one merged "Other" lane
 * aggregating everything beyond the top `n`. Lanes are re-sorted internally
 * so this is safe to call on an unsorted list too.
 *
 * The overflow lanes' zero-count members contribute nothing to the merged
 * count (an itemCount of 0 adds 0 either way) and are effectively skipped —
 * if every lane beyond the top `n` is empty, no "Other" row is materialized
 * at all, matching `TimelineLane`'s existing rule that an empty row still
 * exists in `lanes` but shouldn't clutter a view. `__unfiled__` is not
 * special-cased: it competes for a top-`n` slot on `itemCount` like any
 * other lane and only lands in "Other" if it doesn't make the cut.
 */
export function topLanes(lanes: TimelineLane[], n: number): TimelineLane[] {
  const sorted = [...lanes].sort((a, b) => b.itemCount - a.itemCount || a.title.localeCompare(b.title))
  const top = sorted.slice(0, Math.max(0, n))
  const rest = sorted.slice(Math.max(0, n)).filter((lane) => lane.itemCount > 0)

  if (rest.length === 0) return top

  const otherCount = rest.reduce((sum, lane) => sum + lane.itemCount, 0)
  return [...top, { id: OTHER_LANE_ID, title: OTHER_LANE_TITLE, itemCount: otherCount }]
}

export interface YearColumn {
  year: number
  ids: string[]
}

/**
 * Groups papers into columns by year, ordered ascending. Within a column,
 * ids appear in the same relative order they appeared in the input array
 * (stable — never re-sorted by id or anything else).
 *
 * Year 0 is the project's "date unparseable" sentinel (see deriveTimeline) —
 * a numeric-ascending sort would place undated papers in the LEFTMOST column,
 * visually claiming they predate everything. The no-year column is instead
 * pinned to the far right, after every real year.
 */
export function yearColumns(papers: { id: string; year: number }[]): YearColumn[] {
  const groups = new Map<number, string[]>()
  for (const paper of papers) {
    let ids = groups.get(paper.year)
    if (!ids) {
      ids = []
      groups.set(paper.year, ids)
    }
    ids.push(paper.id)
  }
  const orderKey = (year: number) => (year <= 0 ? Number.POSITIVE_INFINITY : year)
  return [...groups.entries()]
    .sort(([a], [b]) => orderKey(a) - orderKey(b))
    .map(([year, ids]) => ({ year, ids }))
}

/**
 * Top `n` authors ranked by `paperCount` descending (ties broken by `key`
 * ascending for determinism). `AuthorNetworkView` calls this twice for two
 * purposes from one sorted list: once with the render cap (~200) to decide
 * which nodes/edges to draw at all, then again by taking a further prefix
 * of that same result (already sorted) to decide which of the rendered
 * nodes get an on-canvas label (~20) — avoiding label soup.
 */
export function topAuthorsByPaperCount(nodes: AuthorNode[], n: number): AuthorNode[] {
  return [...nodes]
    .sort((a, b) => b.paperCount - a.paperCount || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, n))
}

/**
 * Filters co-author edges to pairs whose BOTH endpoints are in `keys`.
 * This is the guard that keeps d3-force's forceLink from throwing
 * "node not found" when the author list is capped (an edge referencing a
 * dropped author must never reach the simulation).
 */
export function edgesAmongNodes<E extends { a: string; b: string }>(edges: E[], keys: Set<string>): E[] {
  return edges.filter((e) => keys.has(e.a) && keys.has(e.b))
}
