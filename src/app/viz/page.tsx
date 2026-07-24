"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import type { VaultStorage } from "@/lib/vault/storage"
import { deriveKnowledgeGraph, type KnowledgeGraph } from "@/lib/viz/graph"
import { deriveTimeline, type Timeline } from "@/lib/viz/timeline"
import { pageYear } from "@/lib/viz/filter"
import { deriveCitationFlow, loadCitationRefs, type CitationFlow } from "@/lib/viz/citations"
import { deriveAuthorNetwork, type AuthorNetwork } from "@/lib/viz/authors"
import type { CitationRef } from "@/lib/papers/citations-core"
import { VizTabs, type VizTab } from "@/components/viz/VizTabs"
import TimelineView from "@/components/viz/TimelineView"
import CitationFlowView, { type CitationPaper } from "@/components/viz/CitationFlowView"
import AuthorNetworkView from "@/components/viz/AuthorNetworkView"
import { PageHeader } from "@/components/ui/PageHeader"
import { LoadingState } from "@/components/ui/LoadingState"

// Sigma.js touches WebGL/canvas at import time — loaded client-only, same
// discipline as PdfSurface (src/components/reader/ReaderView.tsx).
const GraphView = dynamic(() => import("@/components/viz/GraphView"), { ssr: false })

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="border border-dashed border-border-warm rounded-card px-5 py-10 text-center bg-light-surface">
      <p className="text-[14px] text-muted-text tracking-body">{label} view is coming in the next tasks.</p>
    </div>
  )
}

export default function VizPage() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [tab, setTab] = useState<VizTab>("graph")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refsByPageId, setRefsByPageId] = useState<Map<string, CitationRef[]> | null>(null)
  const [citationFetchState, setCitationFetchState] = useState<"idle" | "fetching" | "done">("idle")

  const refresh = useCallback(async () => {
    const storage = await getOpenVault()
    const b = await loadBundle(storage)
    setBundle(b)
    // Cache-only load (no network) — the Citations tab's Fetch button opts
    // into fetchMissing explicitly.
    const refs = await loadCitationRefs(storage, b, { fetchMissing: false })
    setRefsByPageId(refs)
  }, [])

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [refresh])

  const handleFetchCitations = async () => {
    if (!bundle) return
    // Self-defensive re-entrancy guard (the button is also disabled while
    // fetching, but the handler shouldn't depend on its caller for that).
    if (citationFetchState === "fetching") return
    setCitationFetchState("fetching")
    try {
      const storage: VaultStorage = await getOpenVault()
      const refs = await loadCitationRefs(storage, bundle, { fetchMissing: true })
      setRefsByPageId(refs)
      setCitationFetchState("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCitationFetchState("idle")
    }
  }

  // The vault may have changed in another tab (e.g. an ingest) since this
  // page loaded — Recompute re-reads the bundle and re-derives every view.
  const handleRecompute = async () => {
    setBusy(true)
    setError(null)
    try {
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Derived, never stored: recomputed from the bundle on every load, memoized
  // per bundle reference so switching tabs doesn't re-derive.
  const graph = useMemo<KnowledgeGraph | null>(() => (bundle ? deriveKnowledgeGraph(bundle) : null), [bundle])
  const timeline = useMemo<Timeline | null>(() => (bundle ? deriveTimeline(bundle) : null), [bundle])
  const citationFlow = useMemo<CitationFlow | null>(
    () => (bundle && refsByPageId ? deriveCitationFlow(bundle, refsByPageId) : null),
    [bundle, refsByPageId],
  )
  const authorNetwork = useMemo<AuthorNetwork | null>(
    () => (bundle ? deriveAuthorNetwork(bundle) : null),
    [bundle],
  )
  const citationPapers = useMemo<CitationPaper[]>(() => {
    if (!bundle) return []
    return [...bundle.pages.values()]
      .filter((p) => p.frontmatter.type === "paper")
      .map((p) => ({
        id: p.id,
        title: p.frontmatter.title,
        year: pageYear(p) ?? 0,
      }))
  }, [bundle])

  return (
    <div className="p-7">
      <PageHeader
        title="Dashboard"
        description="Derived from your wiki — recomputed live, nothing stored."
        actions={
          <>
            <VizTabs active={tab} onChange={setTab} />
            <button
              type="button"
              onClick={() => void handleRecompute()}
              disabled={busy || !bundle}
              className="text-[13px] text-espresso hover:text-orange disabled:opacity-50 rounded-pill border border-border-warm px-3 py-1.5 transition-colors"
            >
              {busy ? "Recomputing…" : "Recompute"}
            </button>
          </>
        }
      />

      {error && <p className="mt-3 text-[13px] text-red-600">Error: {error}</p>}

      {!bundle || !graph ? (
        <LoadingState label="Loading vault…" />
      ) : graph.nodes.length === 0 ? (
        <div className="mt-8 border border-border-warm rounded-card px-5 py-6 bg-light-surface max-w-xl">
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
      ) : (
        <div className="mt-6">
          {tab === "graph" && <GraphView graph={graph} />}
          {tab === "timeline" && (timeline ? <TimelineView timeline={timeline} /> : <ComingSoon label="Timeline" />)}
          {tab === "citations" &&
            (citationFlow ? (
              <CitationFlowView
                papers={citationPapers}
                flow={citationFlow}
                fetchState={citationFetchState}
                onFetch={() => void handleFetchCitations()}
              />
            ) : (
              <ComingSoon label="Citations" />
            ))}
          {tab === "authors" &&
            (authorNetwork ? <AuthorNetworkView network={authorNetwork} /> : <ComingSoon label="Authors" />)}
        </div>
      )}
    </div>
  )
}
