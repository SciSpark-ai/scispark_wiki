import { scaleLinear } from "d3-scale"
import type { VolumePoint } from "@/lib/trending/metrics"

export interface Bar {
  x: number
  y: number
  w: number
  h: number
  weekStart: string
  count: number
}

/**
 * Pure bar-chart geometry for the weekly-volume series. The tallest bar fills
 * `height`; zero counts render as zero-height bars sitting on the baseline.
 * Extracted from the component so it can be unit-tested (M8 pattern).
 */
export function barLayout(points: VolumePoint[], opts: { width: number; height: number; gap?: number }): Bar[] {
  if (points.length === 0) return []
  const gap = opts.gap ?? 2
  const slot = opts.width / points.length
  const w = Math.max(0, slot - gap)
  const maxCount = Math.max(1, ...points.map((p) => p.count)) // avoid /0 → NaN
  const y = scaleLinear().domain([0, maxCount]).range([opts.height, 0])
  return points.map((p, i) => {
    const top = y(p.count)
    return { x: i * slot, y: top, w, h: opts.height - top, weekStart: p.weekStart, count: p.count }
  })
}
