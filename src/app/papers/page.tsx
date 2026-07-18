"use client"

import { Suspense, useEffect, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import type { PaperRecord, SourceId } from "@/lib/papers/types"
import { classifySearchIntentRemote } from "@/lib/skills/search-intent-client"
import { getOpenVault } from "@/lib/vault/get-vault"
import { resolvePaperByKey } from "@/lib/papers/resolve"
import { logEvent } from "@/lib/events/log"
import { writeReaderHandoff } from "@/lib/reader/handoff"
import { paperSlug } from "@/lib/wiki/authoring"
import { PaperResultItem } from "@/components/papers/PaperResultItem"
import { PageHeader } from "@/components/ui/PageHeader"
import { Button } from "@/components/ui/Button"
import { LoadingState } from "@/components/ui/LoadingState"

const SOURCES: SourceId[] = ["arxiv", "openalex", "s2", "pubmed"]

/**
 * Search-only (SP2 Task 13) — the selected-paper detail/digest/ingest sub-
 * card that used to crowd this page now lives entirely on `/paper/[key]`.
 * This page is just: search box + intent-ranked results list, each result
 * routing straight to the paper page.
 */
function PapersPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [source, setSource] = useState<SourceId>("arxiv")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<PaperRecord[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Legacy `?paperKey=` deep links (the reader's "Back to digest" link, old
  // bookmarks) redirect to the paper's canonical `/paper/<slug>` route, where
  // the detail/digest view now lives. Stash a reader handoff first — a
  // resolved paper may still be neither in the feed cache nor the wiki.
  useEffect(() => {
    const key = searchParams.get("paperKey")
    if (!key) return
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const paper = await resolvePaperByKey(vault, key)
        if (cancelled || !paper) return
        await writeReaderHandoff(vault, paper)
        if (!cancelled) router.replace(`/paper/${encodeURIComponent(paperSlug(paper))}`)
      } catch {
        // Best-effort redirect — a missing/corrupt cache just leaves the
        // search page as-is rather than throwing.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [searchParams, router])

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setResults(null)
    try {
      // Intent extraction runs BEFORE the search (Search-Intent Skill): classify
      // whether the user wants the most RELEVANT or the most RECENT papers, then
      // rank accordingly. Never throws — degrades to "relevance" on any failure.
      const sort = await classifySearchIntentRemote(q)
      const res = await fetch(`/api/search/${source}?q=${encodeURIComponent(q)}&sort=${sort}`)
      const body = await res.json()
      if (res.ok && Array.isArray(body?.papers)) {
        setResults(body.papers as PaperRecord[])
        void getOpenVault().then((vault) => logEvent(vault, { type: "search", source, query: q, sort }))
      } else {
        setSearchError(typeof body?.error === "string" ? body.error : `search failed (status ${res.status})`)
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  // A just-searched paper is in neither the feed cache nor the wiki yet, so
  // the paper page can't resolve it by slug alone — stash the full record
  // (addressable by both paperKey and paperSlug, see handoff.ts) before
  // navigating. Best-effort: if the write fails, the paper page falls back
  // to its other resolution paths (feed cache / ingested page) or shows
  // "not found" rather than blocking navigation here.
  async function handleOpenPaper(paper: PaperRecord) {
    try {
      const vault = await getOpenVault()
      await writeReaderHandoff(vault, paper)
    } catch {
      // See doc comment above.
    }
    router.push(`/paper/${encodeURIComponent(paperSlug(paper))}`)
  }

  return (
    <div className="p-7">
      <PageHeader
        title="Papers"
        actions={<Link href="/wiki/inbox" className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1">Review inbox</Link>}
      />

      <form onSubmit={handleSearch} className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as SourceId)}
          className="text-[13px] text-espresso border border-border-warm rounded-pill px-3 py-1.5 bg-light-surface"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search papers…"
          className="flex-1 min-w-[220px] text-[13px] text-espresso border border-border-warm rounded-pill px-3 py-1.5 bg-light-surface"
        />
        <Button type="submit" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      {searchError && (
        <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-light-surface text-[13px] text-espresso">
          {searchError}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2 max-w-2xl">
        {results === null && !searching && (
          <div className="text-[13px] text-muted-text tracking-body">Search a source above to find papers.</div>
        )}
        {results !== null && results.length === 0 && (
          <div className="text-[13px] text-muted-text tracking-body">No results.</div>
        )}
        {results?.map((p, i) => (
          <PaperResultItem key={i} paper={p} onSelect={() => handleOpenPaper(p)} />
        ))}
      </div>
    </div>
  )
}

export default function PapersPage() {
  return (
    <Suspense
      fallback={
        <div className="p-7">
          <LoadingState />
        </div>
      }
    >
      <PapersPageContent />
    </Suspense>
  )
}
