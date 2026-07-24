"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { scaleLinear } from "d3-scale"
import { displayTitle } from "@/lib/papers/title"
import type { Timeline, TimelineItem } from "@/lib/viz/timeline"
import { topLanes, OTHER_LANE_ID } from "@/lib/viz/layout"
import { wikiHref } from "@/lib/wiki/href"

const MAX_LANES = 12
const ROW_HEIGHT = 36
const AXIS_TOP = 28
const LABEL_WIDTH = 168
const PX_PER_YEAR_MIN = 48
const PX_PER_YEAR_MAX = 140
const GUTTER_WIDTH = 84
const RIGHT_PADDING = 24
const DOT_RADIUS = 4.5

const PAPER_COLOR = "#f97316" // orange
const FINDING_COLOR = "#2b180a" // espresso
const SELECTED_RING_COLOR = "var(--color-orange)"
const SELECTED_RADIUS = DOT_RADIUS + 2

/** Fractional year (e.g. 2024.5) from an ISO-ish date string, falling back
 * to the item's own year when the date fails to parse (should be rare —
 * `deriveTimeline` already produced `date`/`year` in lockstep). */
function decimalYear(item: TimelineItem): number {
  const d = new Date(item.date)
  if (Number.isNaN(d.getTime())) return item.year
  const y = d.getUTCFullYear()
  const startOfYear = Date.UTC(y, 0, 1)
  const startOfNextYear = Date.UTC(y + 1, 0, 1)
  const frac = (d.getTime() - startOfYear) / (startOfNextYear - startOfYear)
  return y + frac
}

/** Sensible tick years for the axis: every year when the span is narrow,
 * otherwise d3's "nice" tick picker (which naturally lands on decades for
 * wide ranges). */
function tickYears(minYear: number, maxYear: number, pxPerYear: number): number[] {
  const span = maxYear - minYear
  if (span <= 0) return [minYear]
  if (span <= 20) {
    const ticks: number[] = []
    for (let y = minYear; y <= maxYear; y++) ticks.push(y)
    return ticks
  }
  const approxTickCount = Math.max(4, Math.min(10, Math.round((span * pxPerYear) / 90)))
  return scaleLinear().domain([minYear, maxYear]).ticks(approxTickCount).map((t) => Math.round(t))
}

interface TimelineViewProps {
  timeline: Timeline
  /** The workspace's current selection (a bundle page id), if any — an id
   * that doesn't match any rendered item is silently ignored (renders
   * identically to `null`). Optional for back-compat with any caller/test
   * that doesn't wire selection. */
  selectedId?: string | null
  /** Fires with the clicked item's page id when provided. Without it,
   * clicking falls back to this view's pre-selection-wiring behavior
   * (navigate straight to the item's wiki page) so the view stays usable
   * stand-alone. */
  onSelect?: (id: string | null) => void
}

/**
 * Horizontal time axis (d3-scale math, React/SVG rendering) with one lane
 * row per topic (top ~12 by itemCount, the rest merged into "Other" via
 * `topLanes`). Items are dots positioned by date, colored by type. Items
 * with an unparseable date (`year === 0`, excluded from `minYear`/`maxYear`
 * per `deriveTimeline`'s contract) render in a small "undated" gutter at
 * the right end of their row instead of on the axis.
 */
export default function TimelineView({ timeline, selectedId = null, onSelect }: TimelineViewProps) {
  const router = useRouter()
  const [hoveredLane, setHoveredLane] = useState<string | null>(null)

  const selectedLanes = useMemo(() => topLanes(timeline.lanes, MAX_LANES), [timeline.lanes])

  const hasAxis = timeline.items.length > 0 && (timeline.minYear > 0 || timeline.maxYear > 0)

  const { itemsByRow, undatedByRow } = useMemo(() => {
    const topLaneIds = new Set(selectedLanes.filter((l) => l.id !== OTHER_LANE_ID).map((l) => l.id))
    const hasOtherRow = selectedLanes.some((l) => l.id === OTHER_LANE_ID)

    const dated = new Map<string, TimelineItem[]>()
    const undated = new Map<string, TimelineItem[]>()
    for (const lane of selectedLanes) {
      dated.set(lane.id, [])
      undated.set(lane.id, [])
    }

    for (const item of timeline.items) {
      const rowIds = new Set<string>()
      for (const laneId of item.laneIds) {
        if (topLaneIds.has(laneId)) rowIds.add(laneId)
        else if (hasOtherRow) rowIds.add(OTHER_LANE_ID)
      }
      for (const rowId of rowIds) {
        const bucket = item.year > 0 ? dated : undated
        bucket.get(rowId)?.push(item)
      }
    }

    return { itemsByRow: dated, undatedByRow: undated }
  }, [selectedLanes, timeline.items])

  if (timeline.items.length === 0) {
    return (
      <div className="border border-dashed border-border-warm rounded-card px-5 py-10 text-center bg-light-surface">
        <p className="text-[14px] text-muted-text tracking-body">
          No dated papers or findings yet — the timeline fills in as your wiki grows.
        </p>
      </div>
    )
  }

  if (!hasAxis) {
    // Items exist but every one of them has an unparseable date — nothing
    // to put on an axis, but still worth listing.
    return (
      <div className="border border-dashed border-border-warm rounded-card px-5 py-10 text-center bg-light-surface">
        <p className="text-[14px] text-muted-text tracking-body">
          {timeline.items.length} item{timeline.items.length === 1 ? "" : "s"} without a usable date — nothing to
          plot on a timeline yet.
        </p>
      </div>
    )
  }

  const span = Math.max(timeline.maxYear - timeline.minYear, 1)
  const pxPerYear = Math.max(PX_PER_YEAR_MIN, Math.min(PX_PER_YEAR_MAX, Math.round(1200 / span)))
  const chartWidth = span * pxPerYear
  const domainPad = Math.max(0.5, 0.5)
  const scale = scaleLinear()
    .domain([timeline.minYear - domainPad, timeline.maxYear + domainPad])
    .range([0, chartWidth])

  const ticks = tickYears(timeline.minYear, timeline.maxYear, pxPerYear)
  const gutterX = chartWidth + 16
  const totalWidth = LABEL_WIDTH + chartWidth + GUTTER_WIDTH + RIGHT_PADDING
  const totalHeight = AXIS_TOP + selectedLanes.length * ROW_HEIGHT + 12

  const goTo = (id: string) => router.push(wikiHref(id))
  // Selecting drives the workspace's Inspector panel when wired up
  // (VizWorkspace always wires it); without it, a click keeps this view's
  // pre-Task-10 direct-navigate behavior instead of becoming a silent no-op.
  const selectItem = (id: string) => (onSelect ? onSelect(id) : goTo(id))

  return (
    <div data-viz-canvas>
      <p className="mb-3 text-[12px] text-muted-text tracking-body">
        {timeline.items.length} item{timeline.items.length === 1 ? "" : "s"} across {timeline.minYear}
        {timeline.minYear !== timeline.maxYear ? `–${timeline.maxYear}` : ""} · {selectedLanes.length} lane
        {selectedLanes.length === 1 ? "" : "s"}
      </p>
      <div className="border border-border-warm rounded-card bg-light-surface overflow-x-auto">
        <svg width={totalWidth} height={totalHeight} role="img" aria-label="Field timeline">
          {/* Row backgrounds + lane labels */}
          {selectedLanes.map((lane, i) => {
            const y = AXIS_TOP + i * ROW_HEIGHT
            return (
              <g key={lane.id}>
                <rect
                  x={0}
                  y={y}
                  width={totalWidth}
                  height={ROW_HEIGHT}
                  fill={i % 2 === 0 ? "var(--color-light-surface)" : "var(--color-card-surface)"}
                  opacity={hoveredLane && hoveredLane !== lane.id ? 0.5 : 1}
                />
                <text
                  x={12}
                  y={y + ROW_HEIGHT / 2 + 4}
                  className="text-[12px] fill-espresso"
                  onMouseEnter={() => setHoveredLane(lane.id)}
                  onMouseLeave={() => setHoveredLane(null)}
                >
                  {lane.title} ({lane.itemCount})
                </text>
              </g>
            )
          })}

          {/* Gutter divider */}
          <line
            x1={LABEL_WIDTH + gutterX}
            y1={AXIS_TOP}
            x2={LABEL_WIDTH + gutterX}
            y2={totalHeight}
            stroke="var(--color-border-warm)"
            strokeDasharray="3,3"
          />
          <text
            x={LABEL_WIDTH + gutterX + 6}
            y={AXIS_TOP - 10}
            className="text-[10px] fill-muted-text"
          >
            undated
          </text>

          {/* Axis */}
          <g transform={`translate(${LABEL_WIDTH}, ${AXIS_TOP})`}>
            <line x1={0} y1={0} x2={chartWidth} y2={0} stroke="var(--color-border-warm)" />
            {ticks.map((year) => {
              const x = scale(year)
              return (
                <g key={year}>
                  <line x1={x} y1={-4} x2={x} y2={0} stroke="var(--color-border-warm)" />
                  <text x={x} y={-8} textAnchor="middle" className="text-[10px] fill-muted-text">
                    {year}
                  </text>
                </g>
              )
            })}
          </g>

          {/* Items */}
          {selectedLanes.map((lane, i) => {
            const rowCy = AXIS_TOP + i * ROW_HEIGHT + ROW_HEIGHT / 2
            const datedItems = itemsByRow.get(lane.id) ?? []
            const undatedItems = undatedByRow.get(lane.id) ?? []
            return (
              <g key={lane.id}>
                {datedItems.map((item) => {
                  const cx = LABEL_WIDTH + scale(decimalYear(item))
                  const isSelected = item.id === selectedId
                  return (
                    <circle
                      key={item.id}
                      cx={cx}
                      cy={rowCy}
                      r={isSelected ? SELECTED_RADIUS : DOT_RADIUS}
                      fill={item.type === "paper" ? PAPER_COLOR : FINDING_COLOR}
                      stroke={isSelected ? SELECTED_RING_COLOR : "none"}
                      strokeWidth={isSelected ? 2 : 0}
                      data-selected={isSelected ? "true" : undefined}
                      className="cursor-pointer"
                      onClick={() => selectItem(item.id)}
                    >
                      <title>{`${displayTitle(String(item.title ?? ""))} (${item.year}) — ${item.type}`}</title>
                    </circle>
                  )
                })}
                {undatedItems.slice(0, 6).map((item, idx) => {
                  const isSelected = item.id === selectedId
                  return (
                    <circle
                      key={item.id}
                      cx={LABEL_WIDTH + gutterX + 12 + idx * 11}
                      cy={rowCy}
                      r={isSelected ? SELECTED_RADIUS : DOT_RADIUS}
                      fill={item.type === "paper" ? PAPER_COLOR : FINDING_COLOR}
                      stroke={isSelected ? SELECTED_RING_COLOR : "none"}
                      strokeWidth={isSelected ? 2 : 0}
                      data-selected={isSelected ? "true" : undefined}
                      className="cursor-pointer"
                      onClick={() => selectItem(item.id)}
                    >
                      <title>{`${displayTitle(String(item.title ?? ""))} (undated) — ${item.type}`}</title>
                    </circle>
                  )
                })}
                {undatedItems.length > 6 && (
                  <text
                    x={LABEL_WIDTH + gutterX + 12 + 6 * 11}
                    y={rowCy + 4}
                    className="text-[10px] fill-muted-text"
                  >
                    +{undatedItems.length - 6}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <p className="mt-2 text-[12px] text-muted-text tracking-body">
        <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: PAPER_COLOR }} />
        Paper
        <span
          className="inline-block w-2 h-2 rounded-full mr-1 ml-3 align-middle"
          style={{ background: FINDING_COLOR }}
        />
        Finding — hover a dot for details, click to open its wiki page.
      </p>
    </div>
  )
}
