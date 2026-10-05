export interface SpendBar {
  x: number
  y: number
  w: number
  h: number
  date: string
  totalUsd: number | null
}

/**
 * Pure bar-chart geometry for the 7-day spend series (`{date, totalUsd}` from
 * UsageSummary.days). A thin variant of trending's `barLayout` — same "tallest
 * bar fills `height`, zero sits on the baseline" model, but keyed on
 * `date`/`totalUsd` (USD amounts) instead of `weekStart`/`count`, so the two
 * don't share a point type. Extracted from the component so it can be
 * unit-tested (M8/M10 pattern).
 */
export function spendBarLayout(
  days: Array<{ date: string; totalUsd: number | null }>,
  opts: { width: number; height: number; gap?: number },
): SpendBar[] {
  if (days.length === 0) return []
  const gap = opts.gap ?? 2
  const slot = opts.width / days.length
  const w = Math.max(0, slot - gap)
  // Tallest bar fills `height`; when every day is $0 any positive denominator
  // works (all bars are height 0), so `|| 1` only avoids a divide-by-zero.
  const max = Math.max(0, ...days.map((d) => d.totalUsd ?? 0)) || 1
  return days.map((d, i) => {
    const top = opts.height - ((d.totalUsd ?? 0) / max) * opts.height
    return { x: i * slot, y: top, w, h: opts.height - top, date: d.date, totalUsd: d.totalUsd }
  })
}
