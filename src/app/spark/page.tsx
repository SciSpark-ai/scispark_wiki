"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { SparkPanel } from "@/components/spark/SparkPanel"
import { IdeaGallery } from "@/components/spark/IdeaGallery"
import { PageHeader } from "@/components/ui/PageHeader"
import { LoadingState } from "@/components/ui/LoadingState"

async function readOpenBundle(): Promise<Bundle> {
  const vault = await getOpenVault()
  return loadBundle(vault)
}

function SparkPageContent() {
  const searchParams = useSearchParams()

  // Companion "Spark an idea" deep-link (src/lib/companion/triggers.ts):
  // ?cluster=<comma-separated wiki page ids> pre-fills the vault warm-start
  // for the top-level Quick/Deep Spark actions — the user still types a
  // direction and clicks through, the companion only proposes.
  const clusterPageIds = useMemo(() => {
    const raw = searchParams.get("cluster")
    if (!raw) return undefined
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    return ids.length > 0 ? ids : undefined
  }, [searchParams])

  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [bundleError, setBundleError] = useState<string | null>(null)

  const refreshBundle = useCallback(async () => {
    setBundle(await readOpenBundle())
    setBundleError(null)
  }, [])

  useEffect(() => {
    let cancelled = false

    readOpenBundle().then(
      (loaded) => {
        if (cancelled) return
        setBundle(loaded)
        setBundleError(null)
      },
      (error: unknown) => {
        if (cancelled) return
        setBundleError(error instanceof Error ? error.message : String(error))
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="p-7">
      <PageHeader
        title="Spark"
        description="Vault-grounded research idea generation — Quick Spark for a few cheap seeds, Deep Spark for a fully audited idea page."
      />

      <div className="mt-5">
        <SparkPanel clusterPageIds={clusterPageIds} onIdeaSaved={refreshBundle} />
      </div>

      <div className="mt-10">
        <h2 className="font-heading text-[20px] text-espresso tracking-heading-card mb-3">Idea gallery</h2>
        {bundleError && <p className="mb-3 text-[13px] text-red-700">Error: {bundleError}</p>}
        {bundle ? (
          <IdeaGallery bundle={bundle} />
        ) : bundleError ? null : (
          <div className="text-[13px] text-muted-text tracking-body">Loading…</div>
        )}
      </div>
    </div>
  )
}

export default function SparkPage() {
  return (
    <Suspense
      fallback={
        <div className="p-7">
          <LoadingState />
        </div>
      }
    >
      <SparkPageContent />
    </Suspense>
  )
}
