"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Graph from "graphology"
import Sigma from "sigma"
import forceAtlas2 from "graphology-layout-forceatlas2"
import type { KnowledgeGraph } from "@/lib/viz/graph"
import { PAGE_TYPES, type PageType } from "@/lib/vault/types"
import { wikiHref } from "@/lib/wiki/href"
import { displayTitle } from "@/lib/papers/title"
import { truncateGraphLabel } from "./labels"

// sigma and graphology-layout-forceatlas2 both touch WebGL/canvas at import
// time — this module must only ever be loaded client-side via
// next/dynamic(..., { ssr: false }) from the page, same discipline as
// PdfSurface (src/components/reader/ReaderView.tsx).

// Fixed, >=8-hue warm-leaning categorical palette for Louvain communities
// (design tokens: espresso/orange/border-warm family). Indexed by
// `community % COMMUNITY_COLORS.length` so any community count is covered.
const COMMUNITY_COLORS = [
  "#f97316", // orange (brand)
  "#c2410c", // burnt orange
  "#b45309", // amber-800
  "#a16207", // olive gold
  "#dc2626", // warm red
  "#9a3412", // rust
  "#78350f", // deep brown
  "#ea580c", // orange-600
  "#92400e", // amber-700
  "#7c2d12", // deep rust-brown
]

const MIN_NODE_SIZE = 4
const MAX_NODE_SIZE = 16
const MIN_EDGE_SIZE = 0.5
const MAX_EDGE_SIZE = 4
const FA2_ITERATIONS = 200
const CIRCLE_RADIUS = 100

const DEFAULT_EDGE_COLOR = "rgba(43, 24, 10, 0.15)" // espresso @ 15%
const HIGHLIGHT_EDGE_COLOR = "#2b180a" // espresso, solid
const DIM_NODE_COLOR = "#e8d3c0" // border-warm — muted, not hidden
const DIM_EDGE_COLOR = "rgba(43, 24, 10, 0.05)"

function clampedScale(value: number, min: number, max: number, outMin: number, outMax: number): number {
  if (max <= min) return (outMin + outMax) / 2
  const t = (value - min) / (max - min)
  return outMin + Math.max(0, Math.min(1, t)) * (outMax - outMin)
}

// Mirrors Tree.tsx / index-builder.ts's TYPE_HEADINGS (kept in sync
// manually, same as schema-routing.ts mirrors scaffold.ts's TYPE_DIRS
// elsewhere in this repo).
const TYPE_LABELS: Record<PageType, string> = {
  paper: "Papers",
  concept: "Concepts",
  method: "Methods",
  finding: "Findings",
  comparison: "Comparisons",
  author: "Authors",
  topic: "Topics",
  note: "Notes",
  idea: "Ideas",
  project: "Projects",
}

interface TypeFilterRowProps {
  visibleTypes: Set<PageType>
  onToggle: (type: PageType) => void
}

function TypeFilterRow({ visibleTypes, onToggle }: TypeFilterRowProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter graph by page type">
      {PAGE_TYPES.map((type) => {
        const active = visibleTypes.has(type)
        return (
          <label
            key={type}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-[12px] border cursor-pointer transition-colors ${
              active
                ? "bg-card-surface text-espresso border-border-warm"
                : "bg-light-surface text-muted-text/60 border-border-warm/60"
            }`}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => onToggle(type)}
              className="accent-orange"
            />
            {TYPE_LABELS[type]}
          </label>
        )
      })}
    </div>
  )
}

interface GraphViewProps {
  graph: KnowledgeGraph
}

/**
 * Sigma.js (WebGL) knowledge-graph view. Builds a graphology Graph from the
 * derived `KnowledgeGraph`, seeds deterministic circular positions (sorted
 * by node id), runs ForceAtlas2 synchronously for a fixed iteration count,
 * then renders with Sigma. Hover highlights the node + its neighborhood
 * (dimming the rest via reducers); click deep-links to the page's wiki
 * entry; a type-filter row hides node/edge types via the same reducers.
 */
export default function GraphView({ graph }: GraphViewProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const hoveredNodeRef = useRef<string | null>(null)
  const visibleTypesRef = useRef<Set<PageType>>(new Set(PAGE_TYPES))
  const [visibleTypes, setVisibleTypes] = useState<Set<PageType>>(new Set(PAGE_TYPES))

  const toggleType = (type: PageType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // Keep the ref in sync so the reducers (captured once per Sigma instance)
  // always read the latest filter state without rebuilding the graph.
  useEffect(() => {
    visibleTypesRef.current = visibleTypes
    // A node whose type was just toggled off never fires "leaveNode" (it's
    // hidden, not un-hovered) — without this, the reducers would keep
    // dimming its former neighborhood forever. Clearing on every filter
    // change is simpler than tracking the hovered node's type and always
    // safe.
    hoveredNodeRef.current = null
    sigmaRef.current?.refresh()
  }, [visibleTypes])

  useEffect(() => {
    const container = containerRef.current
    // `graph.nodes.length === 0` never reaches this component: the parent
    // page (`src/app/viz/page.tsx`) gates the empty case with its own
    // "Nothing to visualize yet" card before mounting GraphView at all.
    if (!container) return

    const g = new Graph({ type: "undirected" })

    // Deterministic circular seed (sorted by id) before ForceAtlas2 relaxes
    // it — required for reproducible layouts across reloads of the same vault.
    const sortedIds = [...graph.nodes].map((n) => n.id).sort()
    const angleStep = sortedIds.length > 0 ? (2 * Math.PI) / sortedIds.length : 0
    const seedPositions = new Map<string, { x: number; y: number }>()
    sortedIds.forEach((id, i) => {
      seedPositions.set(id, {
        x: CIRCLE_RADIUS * Math.cos(i * angleStep),
        y: CIRCLE_RADIUS * Math.sin(i * angleStep),
      })
    })

    const degrees = graph.nodes.map((n) => n.degree)
    const minDegree = degrees.length ? Math.min(...degrees) : 0
    const maxDegree = degrees.length ? Math.max(...degrees) : 0

    for (const node of graph.nodes) {
      const pos = seedPositions.get(node.id) ?? { x: 0, y: 0 }
      g.addNode(node.id, {
        x: pos.x,
        y: pos.y,
        size: clampedScale(node.degree, minDegree, maxDegree, MIN_NODE_SIZE, MAX_NODE_SIZE),
        color: COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length],
        label: truncateGraphLabel(displayTitle(node.title)),
        // NOT `type` — sigma's DisplayData.type selects the rendering
        // program (circle/etc). Our page type lives in a separate attribute.
        pageType: node.type,
      })
    }

    const weights = graph.edges.map((e) => e.weight)
    const minWeight = weights.length ? Math.min(...weights) : 0
    const maxWeight = weights.length ? Math.max(...weights) : 0

    for (const edge of graph.edges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue
      if (edge.source === edge.target || g.hasEdge(edge.source, edge.target)) continue
      g.addUndirectedEdge(edge.source, edge.target, {
        size: clampedScale(edge.weight, minWeight, maxWeight, MIN_EDGE_SIZE, MAX_EDGE_SIZE),
        weight: edge.weight,
        color: DEFAULT_EDGE_COLOR,
      })
    }

    if (g.order > 1 && g.size > 0) {
      forceAtlas2.assign(g, {
        iterations: FA2_ITERATIONS,
        settings: { ...forceAtlas2.inferSettings(g), gravity: 1, strongGravityMode: true },
      })
    }

    const sigmaInstance = new Sigma(g, container, {
      nodeReducer: (node, data) => {
        if (!visibleTypesRef.current.has(data.pageType as PageType)) {
          return { ...data, hidden: true }
        }
        const hovered = hoveredNodeRef.current
        if (hovered && hovered !== node && !g.areNeighbors(hovered, node)) {
          return { ...data, color: DIM_NODE_COLOR, label: null, zIndex: 0 }
        }
        return data
      },
      edgeReducer: (edge, data) => {
        const [source, target] = g.extremities(edge)
        const sourceType = g.getNodeAttribute(source, "pageType") as PageType
        const targetType = g.getNodeAttribute(target, "pageType") as PageType
        if (!visibleTypesRef.current.has(sourceType) || !visibleTypesRef.current.has(targetType)) {
          return { ...data, hidden: true }
        }
        const hovered = hoveredNodeRef.current
        if (hovered) {
          if (source === hovered || target === hovered) {
            return { ...data, color: HIGHLIGHT_EDGE_COLOR, zIndex: 1 }
          }
          return { ...data, color: DIM_EDGE_COLOR }
        }
        return data
      },
    })

    sigmaInstance.on("enterNode", ({ node }) => {
      hoveredNodeRef.current = node
      sigmaInstance.refresh()
    })
    sigmaInstance.on("leaveNode", () => {
      hoveredNodeRef.current = null
      sigmaInstance.refresh()
    })
    sigmaInstance.on("clickNode", ({ node }) => {
      router.push(wikiHref(node))
    })

    sigmaRef.current = sigmaInstance

    return () => {
      sigmaInstance.kill()
      sigmaRef.current = null
    }
    // `graph` fully determines the instance; `router` is stable for the
    // component's lifetime (Next.js router identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  const stats = useMemo(
    () => `${graph.nodes.length} node${graph.nodes.length === 1 ? "" : "s"} · ${graph.edges.length} edge${graph.edges.length === 1 ? "" : "s"} · ${graph.communities} communit${graph.communities === 1 ? "y" : "ies"}`,
    [graph],
  )

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <TypeFilterRow visibleTypes={visibleTypes} onToggle={toggleType} />
        <p className="text-[12px] text-muted-text tracking-body flex-shrink-0">{stats}</p>
      </div>
      <div
        ref={containerRef}
        className="border border-border-warm rounded-card bg-light-surface"
        style={{ height: 560, width: "100%" }}
      />
      <p className="mt-2 text-[12px] text-muted-text tracking-body">
        Hover a node to see its neighborhood; click to open its wiki page.
      </p>
    </div>
  )
}
