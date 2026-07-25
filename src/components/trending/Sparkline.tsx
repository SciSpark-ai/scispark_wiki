import type { VolumePoint } from "@/lib/trending/metrics"

const WIDTH = 96
const HEIGHT = 24
const PAD = 2

/**
 * A hand-rolled inline SVG polyline over a weekly-volume series — no chart
 * library. Renders nothing below 2 points (a single point has no line to
 * draw, and an empty series has nothing at all).
 */
export function Sparkline({ points }: { points: VolumePoint[] }) {
  if (points.length < 2) return null

  const counts = points.map((p) => p.count)
  const max = Math.max(...counts)
  const min = Math.min(...counts)
  const range = max - min || 1 // avoid /0 when every week is flat

  const step = (WIDTH - PAD * 2) / (points.length - 1)
  const coords = points
    .map((p, i) => {
      const x = PAD + i * step
      const y = PAD + (HEIGHT - PAD * 2) * (1 - (p.count - min) / range)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Weekly volume trend">
      <polyline points={coords} fill="none" className="stroke-orange" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
