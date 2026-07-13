"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { deriveKnowledgeGraph, type KnowledgeGraph } from "@/lib/viz/graph"
import { VizTabs, type VizTab } from "@/components/viz/VizTabs"

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

  const refresh = useCallback(async () => {
    const storage = await getOpenVault()
    const b = await loadBundle(storage)
    setBundle(b)
  }, [])

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [refresh])

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

  return (
    <div className="p-7">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-[28px] text-espresso tracking-heading">Dashboard</h1>
          <p className="mt-1 text-[13px] text-muted-text tracking-body">
            Derived from your wiki — recomputed live, nothing stored.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <VizTabs active={tab} onChange={setTab} />
          <button
            type="button"
            onClick={() => void handleRecompute()}
            disabled={busy || !bundle}
            className="text-[13px] text-espresso hover:text-orange disabled:opacity-50 rounded-pill border border-border-warm px-3 py-1.5 transition-colors"
          >
            {busy ? "Recomputing…" : "Recompute"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-[13px] text-red-600">Error: {error}</p>}

      {!bundle || !graph ? (
        <p className="mt-6 text-[14px] text-muted-text">Loading vault…</p>
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
          {tab === "timeline" && <ComingSoon label="Timeline" />}
          {tab === "citations" && <ComingSoon label="Citations" />}
          {tab === "authors" && <ComingSoon label="Authors" />}
        </div>
      )}
    </div>
  )
}
