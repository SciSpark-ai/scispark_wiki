const WIDTH = 40
const HEIGHT = 22
const BAR_WIDTH = 14
const GAP = WIDTH - BAR_WIDTH * 2
/** Floor so a tiny-but-nonzero count is still a visible sliver rather than nothing. */
const MIN_VISIBLE = 2

/**
 * Two hand-rolled bars — the topic's PRIOR window beside its RECENT one — in
 * place of the weekly sparkline this replaced. No chart library.
 *
 * Both bars are drawn from the exact numbers `growth` is computed from
 * (`priorCount`/`recentCount`), so a row's chart can never disagree with its
 * growth badge; the old sparkline was a separately-fetched series scoped
 * differently, and it did disagree. It also costs zero requests: the counts are
 * already in hand by the time a row exists.
 *
 * `priorCount: 0` (the "new" case, common rather than exceptional) draws an
 * EMPTY prior bar: heights scale to `Math.max(prior, recent)`, which is > 0 in
 * that case, and the all-zero case short-circuits to a flat baseline — so no
 * division by zero and no NaN height can reach the DOM.
 */
export function TrendBars({ priorCount, recentCount }: { priorCount: number; recentCount: number }) {
  const max = Math.max(priorCount, recentCount)
  const priorHeight = barHeight(priorCount, max)
  const recentHeight = barHeight(recentCount, max)

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${priorCount} papers in the prior window, ${recentCount} in the recent window`}
      className="shrink-0"
    >
      <rect
        x={0}
        y={HEIGHT - priorHeight}
        width={BAR_WIDTH}
        height={priorHeight}
        rx={1}
        className="fill-muted-text/35"
      />
      <rect
        x={BAR_WIDTH + GAP}
        y={HEIGHT - recentHeight}
        width={BAR_WIDTH}
        height={recentHeight}
        rx={1}
        className="fill-orange"
      />
    </svg>
  )
}

/**
 * Height in px for `count` against the row's larger count. Always finite:
 * `max <= 0` (both counts zero, or a malformed non-positive count) returns 0
 * rather than dividing, and a non-finite input is treated as zero.
 */
function barHeight(count: number, max: number): number {
  if (!Number.isFinite(count) || count <= 0 || max <= 0) return 0
  return Math.max(MIN_VISIBLE, Math.round((count / max) * HEIGHT))
}
