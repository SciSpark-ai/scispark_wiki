"use client"

import { useEffect, useMemo, useRef } from "react"
import Graph from "graphology"
import Sigma from "sigma"
import type { NodeDisplayData, EdgeDisplayData } from "sigma/types"
import forceAtlas2 from "graphology-layout-forceatlas2"
import type { KnowledgeGraph } from "@/lib/viz/graph"
import { displayTitle } from "@/lib/papers/title"
import { truncateGraphLabel, labelThresholdForRatio } from "./labels"
import {
  nodeSize,
  VIZ_CAT_COUNT,
  FALLBACK_COMMUNITY_PALETTE,
  communityColorVarName,
  communityColor,
} from "./graph-style"

// sigma and graphology-layout-forceatlas2 both touch WebGL/canvas at import
// time — this module must only ever be loaded client-side via
// next/dynamic(..., { ssr: false }) from the page, same discipline as
// PdfSurface (src/components/reader/ReaderView.tsx). Pure helpers used here
// (node sizing, community-color mapping, label threshold) live in
// ./graph-style.ts and ./labels.ts specifically so they stay importable
// from plain jsdom tests without dragging this WebGL boundary along.

const MIN_EDGE_SIZE = 0.5
const MAX_EDGE_SIZE = 4

// Camera ratio at Sigma construction (before any user zoom interaction).
const INITIAL_CAMERA_RATIO = 1

// Selected node's size multiplier — a visible "ring/boost" cue distinct
// from the plain community color, on top of Sigma's `highlighted: true`
// node state (always-on label + hover-style rendering).
const SELECTED_SIZE_BOOST = 1.6

const CIRCLE_RADIUS = 100

// ForceAtlas2 tuning — named constants (replacing graphology's
// order-generic `inferSettings()`) picked for typical vault sizes (tens to
// low hundreds of nodes) to reduce overlap/jitter versus the defaults.
const FA2_ITERATIONS = 300 // relaxation steps for the synchronous run — enough to settle without visible residual jitter
const FA2_GRAVITY = 1 // pulls nodes toward the center so low-degree/disconnected nodes don't drift off-canvas
const FA2_SCALING_RATIO = 14 // node-node repulsion strength; higher spreads clusters apart, reducing label overlap
const FA2_SLOW_DOWN = 4 // damps per-iteration displacement so the fixed-iteration run converges instead of oscillating
const FA2_EDGE_WEIGHT_INFLUENCE = 1 // heavier (higher shared-source/wikilink weight) edges pull their endpoints proportionally closer
const BARNES_HUT_NODE_THRESHOLD = 2000 // above this order, approximate repulsion (Barnes-Hut) instead of exact O(n²) — matches graphology's own inferSettings() default

interface VizTokens {
  categoryPalette: string[]
  dimNode: string
  highlight: string
  defaultEdge: string
  dimEdge: string
}

// Fallbacks for non-browser/test contexts only — the live palette always
// comes from globals.css's --viz-cat-1..8 / --color-border-warm /
// --color-espresso, read fresh at mount and on theme change.
const FALLBACK_TOKENS: VizTokens = {
  categoryPalette: FALLBACK_COMMUNITY_PALETTE,
  dimNode: "#e8d3c0", // border-warm, light theme
  highlight: "#2b180a", // espresso, light theme
  defaultEdge: "rgba(43, 24, 10, 0.15)", // espresso @ 15%
  dimEdge: "#e8d3c0",
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

// Sigma/WebGL needs concrete rgba(), not a CSS var() reference — this
// parses the resolved (already-cascade-correct) hex custom property into
// one. Non-hex input (e.g. an already-rgb()/rgba() computed value) passes
// through unchanged rather than erroring.
function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) return hex
  const int = parseInt(match[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Reads the live theme palette from globals.css's CSS custom properties.
// Called once at mount and again whenever `data-theme` flips (see the
// MutationObserver effect below) — cheap (a handful of getComputedStyle
// calls), so no need to memoize beyond "not on every frame".
function resolveVizTokens(): VizTokens {
  const categoryPalette = Array.from({ length: VIZ_CAT_COUNT }, (_, i) =>
    readCssVar(communityColorVarName(i), FALLBACK_COMMUNITY_PALETTE[i]),
  )
  const dimNode = readCssVar("--color-border-warm", FALLBACK_TOKENS.dimNode)
  const highlight = readCssVar("--color-espresso", FALLBACK_TOKENS.highlight)
  return {
    categoryPalette,
    dimNode,
    highlight,
    defaultEdge: hexToRgba(highlight, 0.15),
    dimEdge: dimNode,
  }
}

interface GraphViewProps {
  graph: KnowledgeGraph
  /** The workspace's current selection (a bundle page id), if any. Drives a
   * persistent neighborhood-focus + ring/size-boost treatment via the node
   * and edge reducers, independent of (and overridden by, while active)
   * hover focus. */
  selectedId?: string | null
  /** Fires on Sigma `clickNode`/`clickStage` with the clicked node's id (or
   * `null` for a stage click, i.e. "deselect"). Required — VizWorkspace is
   * GraphView's only mount point and always wires this up to drive the
   * Inspector panel's selection. */
  onSelectNode: (id: string | null) => void
}

/**
 * Sigma.js (WebGL) knowledge-graph view. Builds a graphology Graph from the
 * derived `KnowledgeGraph` (already filtered by the workspace's FilterBar —
 * this component does no type/tag/year filtering of its own), seeds
 * deterministic circular positions (sorted by node id), runs ForceAtlas2
 * synchronously for a fixed iteration count, then renders with Sigma.
 *
 * Focus model: hovering a node (or, when nothing is hovered, the current
 * `selectedId`) drives a shared "focus" that keeps the focused node + its
 * direct neighbors at full color/size and fades everything else to a
 * token-derived muted color (never opacity — Sigma's WebGL circle program
 * can show visible seams where faded circles overlap). The selected node
 * itself is always exempt from fading, even while hovering elsewhere, and
 * additionally gets Sigma's `highlighted` state, a forced label, and a size
 * boost so the "current selection" stays visually anchored. Click drives
 * the workspace's Inspector selection (`onSelectNode`) instead of
 * navigating away.
 */
export default function GraphView({ graph, selectedId = null, onSelectNode }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const hoveredNodeRef = useRef<string | null>(null)
  const selectedIdRef = useRef<string | null>(selectedId)
  const onSelectNodeRef = useRef(onSelectNode)
  const tokensRef = useRef<VizTokens>(FALLBACK_TOKENS)

  // Kept in sync so the reducers (captured once per Sigma instance) and the
  // click handler always read the latest values without rebuilding the graph.
  useEffect(() => {
    selectedIdRef.current = selectedId
    sigmaRef.current?.refresh()
  }, [selectedId])

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode
  }, [onSelectNode])

  // Theme can flip at runtime (ThemeApplier sets/clears `data-theme` on
  // <html>, e.g. via the settings Appearance card or an OS-level "system"
  // change) — re-reading the palette on that flip is cheap (a handful of
  // getComputedStyle calls), so we do it rather than leaving the graph
  // stuck on whichever theme was active at mount.
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((m) => m.type === "attributes" && m.attributeName === "data-theme")) return
      tokensRef.current = resolveVizTokens()
      sigmaRef.current?.refresh()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    // `graph.nodes.length === 0` never reaches this component: the parent
    // page (`src/app/viz/page.tsx`) gates the empty case with its own
    // "Nothing to visualize yet" card before mounting GraphView at all.
    if (!container) return

    tokensRef.current = resolveVizTokens()
    const tokens = tokensRef.current

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

    const maxDegree = graph.nodes.length ? Math.max(...graph.nodes.map((n) => n.degree)) : 0

    for (const node of graph.nodes) {
      const pos = seedPositions.get(node.id) ?? { x: 0, y: 0 }
      g.addNode(node.id, {
        x: pos.x,
        y: pos.y,
        size: nodeSize(node.degree, maxDegree),
        // Base color computed once here (initial paint before the first
        // reducer pass); the reducer below is authoritative thereafter and
        // recomputes from `community` + the live `tokensRef`, so a theme
        // change repaints correctly without rebuilding the graph.
        color: communityColor(node.community, tokens.categoryPalette),
        community: node.community,
        label: truncateGraphLabel(displayTitle(node.title)),
      })
    }

    const weights = graph.edges.map((e) => e.weight)
    const minWeight = weights.length ? Math.min(...weights) : 0
    const maxWeight = weights.length ? Math.max(...weights) : 0

    for (const edge of graph.edges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue
      if (edge.source === edge.target || g.hasEdge(edge.source, edge.target)) continue
      const t = maxWeight > minWeight ? (edge.weight - minWeight) / (maxWeight - minWeight) : 0.5
      g.addUndirectedEdge(edge.source, edge.target, {
        size: MIN_EDGE_SIZE + (MAX_EDGE_SIZE - MIN_EDGE_SIZE) * Math.max(0, Math.min(1, t)),
        weight: edge.weight,
        color: tokens.defaultEdge,
      })
    }

    if (g.order > 1 && g.size > 0) {
      forceAtlas2.assign(g, {
        iterations: FA2_ITERATIONS,
        settings: {
          gravity: FA2_GRAVITY,
          strongGravityMode: true, // keeps disconnected components pulled toward center rather than flung outward
          scalingRatio: FA2_SCALING_RATIO,
          slowDown: FA2_SLOW_DOWN,
          edgeWeightInfluence: FA2_EDGE_WEIGHT_INFLUENCE,
          barnesHutOptimize: g.order > BARNES_HUT_NODE_THRESHOLD,
        },
      })
    }

    const sigmaInstance = new Sigma(g, container, {
      labelRenderedSizeThreshold: labelThresholdForRatio(INITIAL_CAMERA_RATIO),
      nodeReducer: (node, data): Partial<NodeDisplayData> => {
        const tok = tokensRef.current
        const baseColor = communityColor((data.community as number) ?? 0, tok.categoryPalette)
        const hovered = hoveredNodeRef.current
        const selected = selectedIdRef.current
        const isSelected = selected === node
        // Hover, when active, is the governing focus lens; selection takes
        // over only once hover clears. The selected node itself is always
        // exempt from fading regardless of which lens is active.
        const focus = hovered ?? selected
        const dimmed = !isSelected && focus !== null && focus !== node && !g.areNeighbors(focus, node)

        const result: Partial<NodeDisplayData> = {
          ...data,
          color: dimmed ? tok.dimNode : baseColor,
          label: dimmed ? null : data.label,
        }
        if (isSelected) {
          result.highlighted = true
          result.forceLabel = true
          result.size = (data.size as number) * SELECTED_SIZE_BOOST
          result.zIndex = 2
        } else if (hovered === node) {
          result.forceLabel = true
          result.zIndex = 2
        } else if (dimmed) {
          result.zIndex = 0
        }
        return result
      },
      edgeReducer: (edge, data): Partial<EdgeDisplayData> => {
        const tok = tokensRef.current
        const [source, target] = g.extremities(edge)
        const hovered = hoveredNodeRef.current
        const selected = selectedIdRef.current
        const focus = hovered ?? selected
        if (!focus) return { ...data, color: tok.defaultEdge }
        if (source === focus || target === focus) return { ...data, color: tok.highlight, zIndex: 1 }
        return { ...data, color: tok.dimEdge }
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
      onSelectNodeRef.current(node)
    })
    sigmaInstance.on("clickStage", () => {
      onSelectNodeRef.current(null)
    })

    sigmaRef.current = sigmaInstance

    // Sigma only measures its container's offsetWidth/offsetHeight at
    // construction and on the global `window` resize event (verified in
    // Sigma's own source: no ResizeObserver of its own) — its internal hit
    // testing divides mouse coordinates by that CACHED size. The Inspector
    // panel mounting/unmounting resizes this flex sibling WITHOUT any
    // window resize firing, so every click/hover would hit-test against a
    // stale width until the user happened to resize their window. A
    // ResizeObserver on the same container keeps Sigma's cached dimensions
    // (and camera/quadtree via resize()) in sync with actual layout.
    const resizeObserver = new ResizeObserver(() => {
      sigmaInstance.resize()
      sigmaInstance.refresh()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      sigmaInstance.kill()
      sigmaRef.current = null
    }
    // `graph` fully determines the instance; everything else this effect
    // reads is a ref (stable identity, kept in sync by the effects above).
  }, [graph])

  const stats = useMemo(
    () => `${graph.nodes.length} node${graph.nodes.length === 1 ? "" : "s"} · ${graph.edges.length} edge${graph.edges.length === 1 ? "" : "s"} · ${graph.communities} communit${graph.communities === 1 ? "y" : "ies"}`,
    [graph],
  )

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <p className="text-[12px] text-muted-text tracking-body flex-shrink-0">{stats}</p>
      </div>
      <div
        ref={containerRef}
        data-viz-canvas
        className="border border-border-warm rounded-card bg-light-surface"
        style={{ height: 560, width: "100%" }}
      />
      <p className="mt-2 text-[12px] text-muted-text tracking-body">
        Hover a node to see its neighborhood; click to select it.
      </p>
    </div>
  )
}
