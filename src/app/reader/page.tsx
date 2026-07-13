"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadFeed } from "@/lib/skills/feed"
import { loadBundle } from "@/lib/vault/bundle"
import { loadReaderContent, type ReaderContent } from "@/lib/reader/load"
import { readReaderHandoff } from "@/lib/reader/handoff"
import { paperKey, type PaperRecord } from "@/lib/papers/types"
import type { VaultStorage } from "@/lib/vault/storage"
import type { Frontmatter } from "@/lib/vault/types"
import ReaderView from "@/components/reader/ReaderView"

/**
 * Reconstructs a minimal `PaperRecord` from an ingested paper page's
 * frontmatter (ids + title + authors + year/venue) — enough for
 * `paperKey`/`loadReaderContent`'s snapshot-hit path (an ingested paper
 * already has `sources/<key>.html` snapshotted, so no htmlUrl/oaUrl/pdfUrl is
 * needed to serve it). `source` is a best-effort guess from whichever id is
 * present; it's never used by `loadReaderContent`/`acquireFullText` for a
 * page reconstructed this way since the snapshot always exists first.
 */
function paperRecordFromFrontmatter(fm: Frontmatter): PaperRecord {
  const doi = typeof fm.doi === "string" ? fm.doi : undefined
  const arxiv = typeof fm.arxiv === "string" ? fm.arxiv : undefined
  const openalex = typeof fm.openalex === "string" ? fm.openalex : undefined
  const pmid = typeof fm.pmid === "string" ? fm.pmid : undefined

  const authors = Array.isArray(fm.authors)
    ? (fm.authors as unknown[]).filter((a): a is string => typeof a === "string").map((name) => ({ name }))
    : []

  return {
    ids: { doi, arxiv, openalex, pmid },
    title: typeof fm.title === "string" ? fm.title : "Untitled",
    authors,
    year: typeof fm.year === "number" ? fm.year : undefined,
    venue: typeof fm.venue === "string" ? fm.venue : undefined,
    fields: [],
    source: arxiv ? "arxiv" : pmid ? "pubmed" : openalex ? "openalex" : "s2",
  }
}

/**
 * Resolves the `PaperRecord` for `?paperKey=`: the M5 feed cache first (has
 * htmlUrl/oaUrl/pdfUrl for `acquireFullText`), else an ingested paper page's
 * frontmatter (works because its `sources/` snapshot serves the reader
 * without any URLs — see `paperRecordFromFrontmatter`'s doc comment). `null`
 * when neither resolves.
 */
async function resolvePaper(storage: VaultStorage, key: string): Promise<PaperRecord | null> {
  try {
    const feed = await loadFeed(storage)
    const feedItem = feed?.items.find((it) => paperKey(it.paper) === key)
    if (feedItem) return feedItem.paper

    const bundle = await loadBundle(storage)
    for (const page of bundle.pages.values()) {
      if (page.frontmatter.type !== "paper") continue
      const candidate = paperRecordFromFrontmatter(page.frontmatter)
      if (paperKey(candidate) === key) return candidate
    }

    // Neither in the feed nor ingested — a paper reached via the /papers search
    // box stashes its full record here when the user clicks "Read full paper".
    const handoff = await readReaderHandoff(storage, key)
    if (handoff) return handoff
  } catch {
    // Best-effort resolution, same as the /papers deep-link — a missing/
    // corrupt cache or bundle just falls through to "not found".
  }
  return null
}

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
      const paper = await resolvePaper(storage, key)
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
          <Link href="/papers" className="mt-2 inline-block text-[13px] text-orange hover:text-orange-light">
            Back to papers
          </Link>
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
