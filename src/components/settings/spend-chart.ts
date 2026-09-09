import { scaleLinear } from "d3-scale"

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
  const maxUsd = Math.max(0, ...days.map((d) => d.totalUsd ?? 0))
  // Tallest bar fills `height`; the tallest is the actual max spend (not a
  // floored-to-1 count like trending, since USD maxima are typically < $1).
  // When every day is $0 the denominator is irrelevant — all bars are height 0
  // — so any positive fallback avoids a divide-by-zero → NaN.
  const y = scaleLinear().domain([0, maxUsd > 0 ? maxUsd : 1]).range([opts.height, 0])
  return days.map((d, i) => {
    const top = y(d.totalUsd ?? 0)
    return { x: i * slot, y: top, w, h: opts.height - top, date: d.date, totalUsd: d.totalUsd }
  })
}
