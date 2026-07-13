"use client"

import { useId, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { linkHorizontal } from "d3-shape"
import type { CitationEdge, CitationFlow } from "@/lib/viz/citations"
import { yearColumns } from "@/lib/viz/layout"

const NODE_RADIUS = 6
const COL_WIDTH = 130
const ROW_HEIGHT = 34
const TOP_PADDING = 40
const LEFT_PADDING = 60
const RIGHT_PADDING = 40
const BOTTOM_PADDING = 20

const PAPER_COLOR = "#f97316" // orange
const EDGE_COLOR = "rgba(43, 24, 10, 0.35)" // espresso @ 35%
const EDGE_HIGHLIGHT_COLOR = "#2b180a" // espresso, solid
const NODE_DIM_OPACITY = 0.25
const EDGE_DIM_OPACITY = 0.08
const EDGE_DEFAULT_OPACITY = 0.55

type Hovered = { kind: "node"; id: string } | { kind: "edge"; citing: string; cited: string } | null

export interface CitationPaper {
  id: string
  title: string
  year: number // 0 = unparseable/missing, same convention as TimelineItem.year
}

interface CitationFlowViewProps {
  papers: CitationPaper[]
  flow: CitationFlow
  fetchState: "idle" | "fetching" | "done"
  onFetch: () => void
}

const linkGen = linkHorizontal()

/**
 * Papers-as-nodes-in-year-columns citation graph. Only papers that appear
 * in at least one citation edge are placed on the canvas (`yearColumns`,
 * oldest column first, stacked within a column); papers with no edges are
 * listed in a side strip instead of floated in the canvas. Directed edges
 * (`citing -> cited`) are cubic curves via `d3-shape`'s `linkHorizontal`
 * with an arrowhead marker; hovering an edge or a node highlights the
 * related pair/neighborhood and dims everything else. Header shows
 * coverage ("citation data for N of M papers") and owns nothing about
 * *how* fetching happens — that's entirely the page's job via
 * `fetchState`/`onFetch` props.
 */
export default function CitationFlowView({ papers, flow, fetchState, onFetch }: CitationFlowViewProps) {
  const router = useRouter()
  // Instance-scoped marker id: a fixed string would collide if two views
  // ever mount at once (side-by-side compare, storybook).
  const arrowMarkerId = useId() + "-citation-arrow"
  const [hovered, setHovered] = useState<Hovered>(null)

  const nodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of flow.edges) {
      ids.add(e.citing)
      ids.add(e.cited)
    }
    return ids
  }, [flow.edges])

  const canvasPapers = useMemo(() => papers.filter((p) => nodeIds.has(p.id)), [papers, nodeIds])
  const isolatedPapers = useMemo(() => papers.filter((p) => !nodeIds.has(p.id)), [papers, nodeIds])

  const columns = useMemo(() => yearColumns(canvasPapers), [canvasPapers])

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    columns.forEach((col, colIdx) => {
      col.ids.forEach((id, rowIdx) => {
        map.set(id, { x: LEFT_PADDING + colIdx * COL_WIDTH, y: TOP_PADDING + rowIdx * ROW_HEIGHT })
      })
    })
    return map
  }, [columns])

  const incident = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const add = (a: string, b: string) => {
      let set = map.get(a)
      if (!set) {
        set = new Set()
        map.set(a, set)
      }
      set.add(b)
    }
    for (const e of flow.edges) {
      add(e.citing, e.cited)
      add(e.cited, e.citing)
    }
    return map
  }, [flow.edges])

  const papersById = useMemo(() => new Map(papers.map((p) => [p.id, p] as const)), [papers])

  const goTo = (id: string) => router.push(`/wiki/${id}`)

  const nodeOpacity = (id: string): number => {
    if (!hovered) return 1
    if (hovered.kind === "node") {
      return hovered.id === id || incident.get(hovered.id)?.has(id) ? 1 : NODE_DIM_OPACITY
    }
    return id === hovered.citing || id === hovered.cited ? 1 : NODE_DIM_OPACITY
  }

  const isEdgeHighlighted = (edge: CitationEdge): boolean => {
    if (!hovered) return false
    if (hovered.kind === "edge") return edge.citing === hovered.citing && edge.cited === hovered.cited
    return edge.citing === hovered.id || edge.cited === hovered.id
  }

  const edgeOpacity = (edge: CitationEdge): number => {
    if (!hovered) return EDGE_DEFAULT_OPACITY
    return isEdgeHighlighted(edge) ? 1 : EDGE_DIM_OPACITY
  }

  const maxRows = columns.length > 0 ? Math.max(...columns.map((c) => c.ids.length)) : 0
  const width = LEFT_PADDING + Math.max(columns.length, 1) * COL_WIDTH + RIGHT_PADDING
  const height = TOP_PADDING + Math.max(maxRows, 1) * ROW_HEIGHT + BOTTOM_PADDING

  const coverageLabel = `Citation data for ${flow.papersWithData} of ${flow.papersTotal} paper${
    flow.papersTotal === 1 ? "" : "s"
  }`
  const buttonLabel =
    fetchState === "fetching" ? "Fetching…" : fetchState === "done" ? "Refresh citation data" : "Fetch citation data"

  const noDataYet = flow.papersWithData === 0

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <p className="text-[13px] text-espresso tracking-body">{coverageLabel}</p>
        <button
          type="button"
          onClick={onFetch}
          disabled={fetchState === "fetching"}
          className="text-[13px] text-espresso hover:text-orange disabled:opacity-50 rounded-pill border border-border-warm px-3 py-1.5 transition-colors"
        >
          {buttonLabel}
        </button>
      </div>

      {noDataYet ? (
        <div className="border border-dashed border-border-warm rounded-card px-5 py-10 text-center bg-light-surface">
          <p className="text-[14px] text-muted-text tracking-body">
            No citation data loaded yet — click Fetch citation data above to load references and connect papers in
            your vault.
          </p>
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            {canvasPapers.length === 0 ? (
              <div className="border border-dashed border-border-warm rounded-card px-5 py-10 text-center bg-light-surface">
                <p className="text-[14px] text-muted-text tracking-body">
                  No citation links found among the papers with data yet.
                </p>
              </div>
            ) : (
              <div className="border border-border-warm rounded-card bg-light-surface overflow-x-auto">
                <svg width={width} height={height} role="img" aria-label="Citation flow">
                  <defs>
                    <marker
                      id={arrowMarkerId}
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill={EDGE_HIGHLIGHT_COLOR} />
                    </marker>
                  </defs>

                  {columns.map((col, i) => (
                    <text
                      key={col.year}
                      x={LEFT_PADDING + i * COL_WIDTH}
                      y={TOP_PADDING - 16}
                      textAnchor="middle"
                      className="text-[11px] fill-muted-text"
                    >
                      {col.year > 0 ? col.year : "no year"}
                    </text>
                  ))}

                  {flow.edges.map((edge) => {
                    const s = positions.get(edge.citing)
                    const t = positions.get(edge.cited)
                    if (!s || !t) return null
                    const d = linkGen({ source: [s.x, s.y], target: [t.x, t.y] })
                    if (!d) return null
                    const highlighted = isEdgeHighlighted(edge)
                    return (
                      <path
                        key={`${edge.citing}->${edge.cited}`}
                        d={d}
                        fill="none"
                        stroke={highlighted ? EDGE_HIGHLIGHT_COLOR : EDGE_COLOR}
                        strokeWidth={highlighted ? 2 : 1.25}
                        opacity={edgeOpacity(edge)}
                        markerEnd={`url(#${arrowMarkerId})`}
                        className="cursor-pointer"
                        onMouseEnter={() => setHovered({ kind: "edge", citing: edge.citing, cited: edge.cited })}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <title>{`${papersById.get(edge.citing)?.title ?? edge.citing} cites ${
                          papersById.get(edge.cited)?.title ?? edge.cited
                        }`}</title>
                      </path>
                    )
                  })}

                  {canvasPapers.map((paper) => {
                    const pos = positions.get(paper.id)
                    if (!pos) return null
                    return (
                      <circle
                        key={paper.id}
                        cx={pos.x}
                        cy={pos.y}
                        r={NODE_RADIUS}
                        fill={PAPER_COLOR}
                        opacity={nodeOpacity(paper.id)}
                        className="cursor-pointer"
                        onMouseEnter={() => setHovered({ kind: "node", id: paper.id })}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => goTo(paper.id)}
                      >
                        <title>{`${paper.title}${paper.year > 0 ? ` (${paper.year})` : ""}`}</title>
                      </circle>
                    )
                  })}
                </svg>
              </div>
            )}
          </div>

          {isolatedPapers.length > 0 && (
            <div className="w-56 flex-shrink-0 border border-border-warm rounded-card bg-light-surface p-3 max-h-[420px] overflow-y-auto">
              <p className="text-[11px] text-muted-text tracking-body mb-2">
                {isolatedPapers.length} paper{isolatedPapers.length === 1 ? "" : "s"} with no citation links
              </p>
              <ul className="space-y-1.5">
                {isolatedPapers.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => goTo(p.id)}
                      className="text-[12px] text-espresso hover:text-orange text-left tracking-body"
                    >
                      {p.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[12px] text-muted-text tracking-body">
        Hover an edge or paper to trace citations; click a node to open its wiki page.
      </p>
    </div>
  )
}
