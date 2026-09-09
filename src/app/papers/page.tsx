"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChatWorkspace } from "@/components/chat/ChatWorkspace"
import { LoadingState } from "@/components/ui/LoadingState"
import { getOpenVault } from "@/lib/vault/get-vault"
import { resolvePaperByKey } from "@/lib/papers/resolve"
import { writeReaderHandoff } from "@/lib/reader/handoff"
import { paperSlug } from "@/lib/wiki/authoring"

/** Old paper links still resolve; ordinary Search now shares the chat workspace. */
function PapersEntry() {
  const params = useSearchParams()
  const router = useRouter()
  const key = params.get("paperKey")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!key) return
    let alive = true
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const paper = await resolvePaperByKey(vault, key)
        if (!paper) throw new Error("This paper could not be found. Try searching for its title.")
        await writeReaderHandoff(vault, paper)
        if (alive) router.replace(`/paper/${encodeURIComponent(paperSlug(paper))}`)
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)) }
    })()
    return () => { alive = false }
  }, [key, router])
  if (key && !error) return <LoadingState label="Opening paper…" />
  return <>{error && <p role="alert" className="p-4 text-sm text-espresso">{error}</p>}<ChatWorkspace initialMode="search" fresh={params.get("new") === "1"} /></>
}
export default function PapersPage() {
  return <Suspense fallback={<LoadingState label="Loading conversation…" />}><PapersEntry /></Suspense>
}
