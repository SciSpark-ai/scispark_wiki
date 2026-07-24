"use client"

import { useCallback, useEffect, useState } from "react"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import type { VaultStorage } from "@/lib/vault/storage"
import { loadCitationRefs } from "@/lib/viz/citations"
import type { CitationRef } from "@/lib/papers/citations-core"
import VizWorkspace from "@/components/viz/VizWorkspace"

export default function VizPage() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && <p className="px-6 pt-3 text-[13px] text-red-600 shrink-0">Error: {error}</p>}
      <div className="flex-1 min-h-0">
        <VizWorkspace
          bundle={bundle}
          refsByPageId={refsByPageId}
          citationFetchState={citationFetchState}
          onFetchCitations={() => void handleFetchCitations()}
          onRecompute={() => void handleRecompute()}
          busy={busy}
        />
      </div>
    </div>
  )
}
