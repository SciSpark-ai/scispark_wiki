"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { deriveKnowledgeGraph, type KnowledgeGraph } from "@/lib/viz/graph"
import { deriveTimeline, type Timeline } from "@/lib/viz/timeline"
import { EMPTY_FILTERS, filterBundle, filterOptions, pageYear, type VizFilters } from "@/lib/viz/filter"
import { deriveCitationFlow, type CitationFlow } from "@/lib/viz/citations"
import { deriveAuthorNetwork, type AuthorNetwork } from "@/lib/viz/authors"
import type { CitationRef } from "@/lib/papers/citations-core"
import type { Bundle } from "@/lib/vault/bundle"
import { VizTabs, type VizTab } from "./VizTabs"
import { FilterBar } from "./FilterBar"
import TimelineView from "./TimelineView"
import CitationFlowView, { type CitationPaper } from "./CitationFlowView"
import AuthorNetworkView from "./AuthorNetworkView"
import { LoadingState } from "@/components/ui/LoadingState"

// Sigma.js touches WebGL/canvas at import time — loaded client-only, same
// discipline as PdfSurface (src/components/reader/ReaderView.tsx). This
// dynamic-import boundary moved here (from src/app/viz/page.tsx) along with
// the rest of the derived-view rendering.
const GraphView = dynamic(() => import("./GraphView"), { ssr: false })

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-border-warm rounded-card px-5 py-10 text-center bg-light-surface">
      <p className="text-[14px] text-muted-text tracking-body">{label} view is coming in the next tasks.</p>
    </div>
  )
}

interface VizWorkspaceProps {
  bundle: Bundle | null
  refsByPageId: Map<string, CitationRef[]> | null
  citationFetchState: "idle" | "fetching" | "done"
  onFetchCitations: () => void
  onRecompute: () => void
  busy: boolean
  /** Test-only seed for the initial filters state (defaults to
   * `EMPTY_FILTERS`); production callers never pass this. */
  initialFilters?: VizFilters
}

/**
 * The `/viz` workspace shell: a lens switcher (VizTabs, reused verbatim) +
 * FilterBar toolbar over a full-height canvas that renders whichever of the
 * four derived views is active. Owns `{lens, filters, selectedId}` as a
 * single component state so switching lenses never resets the user's
 * filters or (once Tasks 8–10 wire it up) their current selection.
 */
export default function VizWorkspace({
  bundle,
  refsByPageId,
  citationFetchState,
  onFetchCitations,
  onRecompute,
  busy,
  initialFilters,
}: VizWorkspaceProps) {
  const [lens, setLens] = useState<VizTab>("graph")
  const [filters, setFilters] = useState<VizFilters>(initialFilters ?? EMPTY_FILTERS)
  // Held for Tasks 8–10 (per-lens node/edge selection + inspector panel).
  // No view wires an onSelect callback yet, so this never becomes non-null
  // today — it's reserved state, not a live feature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const options = useMemo(() => (bundle ? filterOptions(bundle) : { types: [], tags: [], yearBounds: null }), [bundle])

  // Derived, never stored: recomputed from the bundle on every load, memoized
  // per bundle+filters reference so switching lenses doesn't re-derive.
  // filterBundle is identity on empty filters, so this is a no-op re-derive
  // (not a re-filter) whenever `filters` is EMPTY_FILTERS.
  const filtered = useMemo(() => (bundle ? filterBundle(bundle, filters) : null), [bundle, filters])

  // Unfiltered graph node count distinguishes "vault is genuinely empty"
  // (existing behavior) from "filters excluded everything" (new behavior) —
  // both checks need the SAME derive function, over different bundles.
  const unfilteredGraph = useMemo<KnowledgeGraph | null>(() => (bundle ? deriveKnowledgeGraph(bundle) : null), [bundle])
  const graph = useMemo<KnowledgeGraph | null>(() => (filtered ? deriveKnowledgeGraph(filtered) : null), [filtered])
  const timeline = useMemo<Timeline | null>(() => (filtered ? deriveTimeline(filtered) : null), [filtered])
  const citationFlow = useMemo<CitationFlow | null>(
    () => (filtered && refsByPageId ? deriveCitationFlow(filtered, refsByPageId) : null),
    [filtered, refsByPageId],
  )
  const authorNetwork = useMemo<AuthorNetwork | null>(
    () => (filtered ? deriveAuthorNetwork(filtered) : null),
    [filtered],
  )
  const citationPapers = useMemo<CitationPaper[]>(() => {
    if (!filtered) return []
    return [...filtered.pages.values()]
      .filter((p) => p.frontmatter.type === "paper")
      .map((p) => ({
        id: p.id,
        title: p.frontmatter.title,
        year: pageYear(p) ?? 0,
      }))
  }, [filtered])

  const isEmptyVault = bundle !== null && unfilteredGraph !== null && unfilteredGraph.nodes.length === 0
  const isFilteredEmpty =
    !isEmptyVault && bundle !== null && graph !== null && unfilteredGraph !== null && graph.nodes.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-warm px-6 py-3 shrink-0">
        <VizTabs active={lens} onChange={setLens} />
        <div className="flex flex-wrap items-center gap-3">
          <FilterBar options={options} filters={filters} onChange={setFilters} />
          <button
            type="button"
            onClick={onRecompute}
            disabled={busy || !bundle}
            className="text-[13px] text-espresso hover:text-orange disabled:opacity-50 rounded-pill border border-border-warm px-3 py-1.5 transition-colors shrink-0"
          >
            {busy ? "Recomputing…" : "Recompute"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {!bundle || !unfilteredGraph ? (
          <LoadingState label="Loading vault…" />
        ) : isEmptyVault ? (
          <div className="border border-border-warm rounded-card px-5 py-6 bg-light-surface max-w-xl">
            <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">Nothing to visualize yet</h2>
            <p className="mt-2 text-[13px] text-muted-text tracking-body">
              Ingest a few papers to grow your graph — the dashboard fills in as your wiki does.
            </p>
            <Link
              href="/papers"
              className="mt-3 inline-block text-[13px] text-orange hover:text-orange-light font-medium"
            >
              Go to Papers
            </Link>
          </div>
        ) : isFilteredEmpty ? (
          <div className="border border-border-warm rounded-card px-5 py-6 bg-light-surface max-w-xl">
            <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">No pages match these filters</h2>
            <p className="mt-2 text-[13px] text-muted-text tracking-body">
              Try widening your type, tag, or year selection.
            </p>
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="mt-3 text-[13px] text-orange hover:text-orange-light font-medium"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {lens === "graph" && graph && <GraphView graph={graph} />}
            {lens === "timeline" && (timeline ? <TimelineView timeline={timeline} /> : <ComingSoon label="Timeline" />)}
            {lens === "citations" &&
              (citationFlow ? (
                <CitationFlowView
                  papers={citationPapers}
                  flow={citationFlow}
                  fetchState={citationFetchState}
                  onFetch={onFetchCitations}
                />
              ) : (
                <ComingSoon label="Citations" />
              ))}
            {lens === "authors" &&
              (authorNetwork ? <AuthorNetworkView network={authorNetwork} /> : <ComingSoon label="Authors" />)}
          </>
        )}
      </div>
    </div>
  )
}
