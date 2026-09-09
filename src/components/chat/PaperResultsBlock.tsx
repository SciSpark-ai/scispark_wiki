"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { ResearchSearchResult } from "@/lib/skills/research-search-contract"
import type { PaperRecord } from "@/lib/papers/types"
import { paperKey } from "@/lib/papers/types"
import { paperSlug } from "@/lib/wiki/authoring"
import { getOpenVault } from "@/lib/vault/get-vault"
import { writeReaderHandoff } from "@/lib/reader/handoff"
import { ResearchSearchResultItem } from "@/components/papers/ResearchSearchResultItem"

export function PaperResultsBlock({ result, citationsOnly = false }: { result: ResearchSearchResult; citationsOnly?: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  async function open(paper: PaperRecord) {
    try {
      // The saved snapshot still opens after feed/search caches have expired.
      await writeReaderHandoff(await getOpenVault(), paper)
      router.push(`/paper/${encodeURIComponent(paperSlug(paper))}`)
    } catch { setError("Could not open this paper. Please try again.") }
  }
  if (citationsOnly) return <div aria-label="Cited papers" className="mt-3 flex flex-wrap gap-2">
    {result.items.map(({ paper }) => <button key={paperKey(paper)} type="button" onClick={() => void open(paper)} className="rounded-pill border border-border-warm px-3 py-1 text-left text-xs text-orange hover:bg-card-surface">{paper.title}</button>)}
    {error && <p role="alert">{error}</p>}
  </div>
  return <section aria-label="Saved paper results" className="mt-4 min-w-0">
    {result.warnings.map((warning) => <p key={warning} className="text-sm text-muted-text">{warning}</p>)}
    {result.items.map((item, index) => <ResearchSearchResultItem key={paperKey(item.paper)} item={item} index={index} onSelect={() => void open(item.paper)} />)}
    {error && <p role="alert" className="text-sm text-espresso">{error}</p>}
    <details className="mt-3 text-sm text-muted-text">
      <summary className="cursor-pointer">Search details</summary>
      <p className="mt-2">{result.plan.interpretation}</p>
      <ul className="mt-2 space-y-2">{result.plan.queries.map((q, i) => <li key={i}>{q.source}: {q.query}</li>)}</ul>
    </details>
  </section>
}
