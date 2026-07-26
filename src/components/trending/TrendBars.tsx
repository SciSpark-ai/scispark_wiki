const WIDTH = 40
const HEIGHT = 22
const BAR_WIDTH = 14
const GAP = WIDTH - BAR_WIDTH * 2
/** Floor so a tiny-but-nonzero share is still a visible sliver rather than nothing. */
const MIN_VISIBLE = 2

export interface TrendBarsProps {
  /** The topic's share of its discipline's prior-window corpus (0 = "new"). */
  priorShare: number
  /** Its share of the recent-window corpus. */
  recentShare: number
  /** Raw volumes — described in the accessible label, never drawn to scale. */
  priorCount: number
  recentCount: number
}

/**
 * Two hand-rolled bars — the topic's PRIOR window beside its RECENT one — in
 * place of the weekly sparkline this replaced. No chart library.
 *
 * Both bars are scaled from the exact figures `growth` is computed from: the
 * SHARES (`priorShare`/`recentShare`), not the raw counts. That is the whole
 * point. OpenAlex under-indexes the most recent window for every topic alike,
 * so raw counts fall board-wide (~39% on the live 2026-07-25 numbers) while
 * shares do not; drawing raw bars beside a share-based badge would show a
 * visibly SHRINKING recent bar next to a positive percentage — a chart
 * disagreeing with the number beside it, which is exactly the defect the
 * sparkline was removed for. Raw counts stay in the accessible label (and as
 * text on the expanded row) as honest absolute volume.
 *
 * `priorShare: 0` (the "new" case, common rather than exceptional) draws an
 * EMPTY prior bar: heights scale to `Math.max(prior, recent)`, which is > 0 in
 * that case, and the all-zero case short-circuits to a flat baseline — so no
 * division by zero and no NaN height can reach the DOM.
 */
export function TrendBars({ priorShare, recentShare, priorCount, recentCount }: TrendBarsProps) {
  const max = Math.max(priorShare, recentShare)
  const priorHeight = barHeight(priorShare, max)
  const recentHeight = barHeight(recentShare, max)

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={
        `${formatShare(priorShare)} of the field's papers in the prior window (${priorCount}), ` +
        `${formatShare(recentShare)} in the recent window (${recentCount})`
      }
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
 * Height in px for `share` against the row's larger share. Always finite:
 * `max <= 0` (both shares zero, or a malformed non-positive share) returns 0
 * rather than dividing, and a non-finite input is treated as zero.
 */
function barHeight(share: number, max: number): number {
  if (!Number.isFinite(share) || share <= 0 || max <= 0) return 0
  return Math.max(MIN_VISIBLE, Math.round((share / max) * HEIGHT))
}

/** A share as a percentage of the discipline; never NaN%. */
function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%"
  return `${(share * 100).toFixed(2)}%`
}
