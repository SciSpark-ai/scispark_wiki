import type { VolumePoint } from "@/lib/trending/metrics"
import { barLayout } from "./chart-geometry"

const WIDTH = 220
const HEIGHT = 44

export function PublicationVolumeChart({ points }: { points: VolumePoint[] }) {
  const bars = barLayout(points, { width: WIDTH, height: HEIGHT })
  if (bars.length === 0) return <div className="text-[12px] text-muted-text">No recent volume</div>
  return (
    <svg width={WIDTH} height={HEIGHT} role="img" aria-label="Weekly publication volume" className="overflow-visible">
      {bars.map((b) => (
        <rect key={b.weekStart} x={b.x} y={b.y} width={b.w} height={b.h} rx={1.5} className="fill-orange">
          <title>{`${b.weekStart}: ${b.count}`}</title>
        </rect>
      ))}
    </svg>
  )
}
