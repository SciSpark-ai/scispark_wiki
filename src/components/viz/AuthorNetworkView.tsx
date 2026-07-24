"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { forceSimulation, forceManyBody, forceLink, forceCollide, forceCenter } from "d3-force"
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force"
import type { AuthorNetwork } from "@/lib/viz/authors"
import { topAuthorsByPaperCount, edgesAmongNodes } from "@/lib/viz/layout"
import { wikiHref } from "@/lib/wiki/href"

const MAX_NODES = 200
const MAX_LABELS = 20
const TICKS = 300

const NODE_MIN_RADIUS = 4
const NODE_MAX_RADIUS = 18
const EDGE_MIN_WIDTH = 0.75
const EDGE_MAX_WIDTH = 5

const VIEW_WIDTH = 900
const VIEW_HEIGHT = 560

const NODE_COLOR = "#f97316" // orange (brand)
const NODE_DIM_COLOR = "#e8d3c0" // border-warm — muted, not hidden
const EDGE_COLOR = "rgba(43, 24, 10, 0.25)" // espresso @ 25%
const EDGE_HIGHLIGHT_COLOR = "#2b180a" // espresso, solid
const EDGE_DIM_OPACITY = 0.08
const SELECTED_RING_COLOR = "var(--color-orange)"
const SELECTED_RADIUS_BOOST = 1.3

interface SimNode extends SimulationNodeDatum {
  id: string // author key
  name: string
  paperCount: number
  pageId: string | null
  radius: number
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  papers: number
  width: number
}

interface LaidOutNetwork {
  nodes: SimNode[]
  links: SimLink[]
  overflowTotal: number // 0 when nothing was cut by MAX_NODES
}

function clampedScale(value: number, min: number, max: number, outMin: number, outMax: number): number {
  if (max <= min) return (outMin + outMax) / 2
  const t = (value - min) / (max - min)
  return outMin + Math.max(0, Math.min(1, t)) * (outMax - outMin)
}

/**
 * Runs a d3-force simulation synchronously for a fixed tick count and
 * returns final node/link positions — no animation loop, React renders the
 * SVG once from the settled layout. Positions are left to d3-force's
 * default phyllotaxis seeding (deterministic, and its random source is a
 * fixed-seed LCG by default) rather than hand-seeded, so the only thing
 * that needs to be deterministic on our end is node *order* going in —
 * `topAuthorsByPaperCount`'s tie-break on `key` guarantees that.
 */
function layoutNetwork(network: AuthorNetwork): LaidOutNetwork {
  const capped = topAuthorsByPaperCount(network.nodes, MAX_NODES)
  const overflowTotal = network.nodes.length > MAX_NODES ? network.nodes.length : 0

  const cappedKeys = new Set(capped.map((n) => n.key))
  const paperCounts = capped.map((n) => n.paperCount)
  const minPapers = paperCounts.length ? Math.min(...paperCounts) : 0
  const maxPapers = paperCounts.length ? Math.max(...paperCounts) : 0

  const nodes: SimNode[] = capped.map((n) => ({
    id: n.key,
    name: n.name,
    paperCount: n.paperCount,
    pageId: n.pageId,
    radius: clampedScale(n.paperCount, minPapers, maxPapers, NODE_MIN_RADIUS, NODE_MAX_RADIUS),
  }))

  const edgesInScope = edgesAmongNodes(network.edges, cappedKeys)
  const edgeCounts = edgesInScope.map((e) => e.papers)
  const minEdge = edgeCounts.length ? Math.min(...edgeCounts) : 0
  const maxEdge = edgeCounts.length ? Math.max(...edgeCounts) : 0

  const links: SimLink[] = edgesInScope.map((e) => ({
    source: e.a,
    target: e.b,
    papers: e.papers,
    width: clampedScale(e.papers, minEdge, maxEdge, EDGE_MIN_WIDTH, EDGE_MAX_WIDTH),
  }))

  if (nodes.length > 1) {
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(60),
      )
      .force("charge", forceManyBody<SimNode>().strength(-90))
      .force("collide", forceCollide<SimNode>((d) => d.radius + 6))
      .force("center", forceCenter<SimNode>(VIEW_WIDTH / 2, VIEW_HEIGHT / 2))
      .stop()
    for (let i = 0; i < TICKS; i++) sim.tick()

    // Keep the settled layout inside the visible canvas — the forces pull
    // toward the center but nothing hard-clamps stragglers to the bounds.
    for (const node of nodes) {
      node.x = Math.max(node.radius, Math.min(VIEW_WIDTH - node.radius, node.x ?? VIEW_WIDTH / 2))
      node.y = Math.max(node.radius, Math.min(VIEW_HEIGHT - node.radius, node.y ?? VIEW_HEIGHT / 2))
    }
  } else if (nodes.length === 1) {
    nodes[0].x = VIEW_WIDTH / 2
    nodes[0].y = VIEW_HEIGHT / 2
  }

  return { nodes, links, overflowTotal }
}

interface AuthorNetworkViewProps {
  network: AuthorNetwork
  /** The workspace's current selection (a bundle page id), if any — an id
   * that doesn't match any rendered author's `pageId` is silently ignored
   * (renders identically to `null`). Optional for back-compat with any
   * caller/test that doesn't wire selection. */
  selectedId?: string | null
  /** Fires with the clicked author's wiki page id — only for nodes that
   * have one (`pageId !== null`); a pageless author's click stays a no-op,
   * unchanged by this. Without `onSelect`, a paged node's click falls back
   * to this view's pre-selection-wiring behavior (navigate straight to the
   * author's wiki page) so the view stays usable stand-alone. */
  onSelect?: (id: string | null) => void
}

/**
 * Co-authorship network: nodes sized by `paperCount`, edges widthed by
 * co-authored paper count, laid out with a synchronous d3-force pass
 * (charge + link + collide + centering, fixed tick count, no animation
 * loop). Rendering is capped to the ~200 highest-paperCount authors; only
 * the top ~20 of those get an on-canvas label to avoid label soup. Clicking
 * a node with a wiki author page selects it (or navigates there directly
 * when `onSelect` isn't wired); authors without one are a no-op click with
 * a native tooltip.
 */
export default function AuthorNetworkView({ network, selectedId = null, onSelect }: AuthorNetworkViewProps) {
  const router = useRouter()
  const [hovered, setHovered] = useState<string | null>(null)

  const { nodes, links, overflowTotal } = useMemo(() => layoutNetwork(network), [network])

  // `nodes` is already paperCount-descending (layoutNetwork built it from
  // `topAuthorsByPaperCount`'s sorted+capped result) — the top MAX_LABELS
  // entries are simply the first MAX_LABELS of this array.
  const labelKeys = useMemo(() => new Set(nodes.slice(0, MAX_LABELS).map((n) => n.id)), [nodes])

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
    for (const link of links) {
      const source = typeof link.source === "object" ? link.source.id : String(link.source)
      const target = typeof link.target === "object" ? link.target.id : String(link.target)
      add(source, target)
      add(target, source)
    }
    return map
  }, [links])

  const goTo = (node: SimNode) => {
    if (node.pageId) router.push(wikiHref(node.pageId))
  }
  // Selecting drives the workspace's Inspector panel when wired up
  // (VizWorkspace always wires it); without it, a click keeps this view's
  // pre-Task-10 direct-navigate behavior instead of becoming a silent no-op.
  // A pageless author has nothing to select or navigate to either way.
  const selectNode = (node: SimNode) => {
    if (!node.pageId) return
    if (onSelect) onSelect(node.pageId)
    else goTo(node)
  }

  const nodeOpacity = (id: string): number => {
    if (!hovered) return 1
    return hovered === id || incident.get(hovered)?.has(id) ? 1 : 0.35
  }

  if (network.nodes.length === 0) {
    return (
      <div className="border border-dashed border-border-warm rounded-card px-5 py-10 text-center bg-light-surface">
        <p className="text-[14px] text-muted-text tracking-body">
          No co-authorship data yet — the collaboration network fills in as your wiki grows.
        </p>
      </div>
    )
  }

  const stats = `${nodes.length} author${nodes.length === 1 ? "" : "s"} · ${links.length} co-authorship link${
    links.length === 1 ? "" : "s"
  }`

  return (
    <div data-viz-canvas>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <p className="text-[12px] text-muted-text tracking-body">{stats}</p>
        {overflowTotal > 0 && (
          <p className="text-[12px] text-muted-text tracking-body">
            Showing top {MAX_NODES} of {overflowTotal} authors, ranked by paper count.
          </p>
        )}
      </div>
      <div className="border border-border-warm rounded-card bg-light-surface overflow-x-auto">
        <svg width={VIEW_WIDTH} height={VIEW_HEIGHT} role="img" aria-label="Author collaboration network">
          {links.map((link, i) => {
            const source = typeof link.source === "object" ? link.source : undefined
            const target = typeof link.target === "object" ? link.target : undefined
            if (!source || !target) return null
            const highlighted =
              hovered !== null && (hovered === source.id || hovered === target.id)
            return (
              <line
                key={i}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={highlighted ? EDGE_HIGHLIGHT_COLOR : EDGE_COLOR}
                strokeWidth={link.width}
                opacity={hovered && !highlighted ? EDGE_DIM_OPACITY : 1}
              >
                <title>{`${source.name} & ${target.name} — ${link.papers} shared paper${link.papers === 1 ? "" : "s"}`}</title>
              </line>
            )
          })}
          {nodes.map((node) => {
            const hasPage = node.pageId !== null
            const isSelected = hasPage && node.pageId === selectedId
            return (
              <g key={node.id}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isSelected ? node.radius * SELECTED_RADIUS_BOOST : node.radius}
                  fill={hovered && nodeOpacity(node.id) < 1 ? NODE_DIM_COLOR : NODE_COLOR}
                  stroke={isSelected ? SELECTED_RING_COLOR : "none"}
                  strokeWidth={isSelected ? 2 : 0}
                  data-selected={isSelected ? "true" : undefined}
                  opacity={nodeOpacity(node.id)}
                  className={hasPage ? "cursor-pointer" : "cursor-default"}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => selectNode(node)}
                >
                  <title>
                    {`${node.name} — ${node.paperCount} paper${node.paperCount === 1 ? "" : "s"}`}
                    {hasPage ? "" : " — no author page yet"}
                  </title>
                </circle>
                {labelKeys.has(node.id) && (
                  <text
                    x={node.x}
                    y={(node.y ?? 0) - node.radius - 4}
                    textAnchor="middle"
                    className="text-[10px] fill-espresso pointer-events-none"
                  >
                    {node.name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <p className="mt-2 text-[12px] text-muted-text tracking-body">
        Hover an author to trace collaborators; click to open their wiki page (authors without one are shown but not
        linked — top {MAX_LABELS} by paper count are labeled).
      </p>
    </div>
  )
}
