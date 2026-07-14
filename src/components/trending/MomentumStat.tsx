export function MomentumStat({ recent, pctChange }: { recent: number; pctChange: number | null }) {
  const up = pctChange !== null && pctChange > 0
  const down = pctChange !== null && pctChange < 0
  const pctLabel = pctChange === null ? "—" : `${up ? "+" : ""}${Math.round(pctChange * 100)}%`
  const arrow = up ? "▲" : down ? "▼" : "→"
  const tone = up ? "text-green-700" : down ? "text-red-700" : "text-muted-text"
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-heading text-[24px] text-espresso tracking-heading">{recent}</span>
      <span className="text-[12px] text-muted-text">papers / 2 wks</span>
      <span className={`text-[12px] ${tone}`}>{arrow} {pctLabel}</span>
    </div>
  )
}
