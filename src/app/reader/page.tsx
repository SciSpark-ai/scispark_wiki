"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { BackLink } from "@/components/ui/BackLink"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadReaderContent, type ReaderContent } from "@/lib/reader/load"
import { resolvePaperByKey } from "@/lib/papers/resolve"
import type { PaperRecord } from "@/lib/papers/types"
import type { VaultStorage } from "@/lib/vault/storage"
import ReaderView from "@/components/reader/ReaderView"

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "ready"; storage: VaultStorage; paper: PaperRecord; content: ReaderContent }

function ReaderPageContent() {
  const searchParams = useSearchParams()
  const key = searchParams.get("paperKey")
  const [state, setState] = useState<PageState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!key) {
        if (!cancelled) setState({ status: "not-found" })
        return
      }
      setState({ status: "loading" })
      const storage = await getOpenVault()
      const paper = await resolvePaperByKey(storage, key)
      if (cancelled) return
      if (!paper) {
        setState({ status: "not-found" })
        return
      }
      const content = await loadReaderContent(storage, paper)
      if (cancelled) return
      setState({ status: "ready", storage, paper, content })
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  if (state.status === "loading") {
    return <div className="p-7 text-[14px] text-muted-text">Loading…</div>
  }

  if (state.status === "not-found") {
    return (
      <div className="p-7">
        <div className="border border-border-warm rounded-card px-4 py-3 bg-light-surface max-w-2xl">
          <div className="text-[14px] text-espresso">Paper not found.</div>
          <BackLink className="mt-2" />
        </div>
      </div>
    )
  }

  return <ReaderView paper={state.paper} content={state.content} storage={state.storage} />
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<div className="p-7 text-[14px] text-muted-text">Loading…</div>}>
      <ReaderPageContent />
    </Suspense>
  )
}
