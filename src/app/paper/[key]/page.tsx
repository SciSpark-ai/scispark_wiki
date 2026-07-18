"use client"

import { Suspense, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle } from "@/lib/vault/bundle"
import { resolvePaperBySlug, extractAbstractFromBody } from "@/lib/papers/resolve"
import { resolvePaperPageState, type PaperPageState } from "@/lib/papers/page-state"
import { paperKey, type PaperRecord } from "@/lib/papers/types"
import { savePaper } from "@/lib/papers/save-client"
import { generateDigestRemote, ingestRemote, undoIngestRemote } from "@/lib/skills/ingest-client"
import { enrichRemote } from "@/lib/skills/enrich-client"
import { loadFeed, type FeedItem } from "@/lib/skills/feed"
import { logEvent } from "@/lib/events/log"
import type { VaultStorage } from "@/lib/vault/storage"
import { PaperHeader } from "@/components/paper/PaperHeader"
import { PaperActions, type DigestState, type EnrichState, type IngestState, type SaveState } from "@/components/paper/PaperActions"
import { PaperDigestView } from "@/components/paper/PaperDigestView"
import { PaperMeta } from "@/components/paper/PaperMeta"
import { RelatedInWiki, resolveRelatedPages, type RelatedPageLink } from "@/components/paper/RelatedInWiki"
import { useCompanion } from "@/components/companion/useCompanion"
import { Card } from "@/components/ui/Card"
import { EmptyState } from "@/components/ui/EmptyState"
import { LoadingState } from "@/components/ui/LoadingState"

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | {
      status: "ready"
      storage: VaultStorage
      paper: PaperRecord
      pageState: PaperPageState
      /** True only once the paper page's own frontmatter has confirmed no
       * full text was acquired — false/unknown leaves "Read full text" enabled. */
      fullTextKnownFalse: boolean
      /** Tier-2 Enrich Skill output off the paper page's own frontmatter
       * (`tldr`/`tags`) — absent until the paper's been enriched. */
      tldr?: string
      tags?: string[]
      /** `frontmatter.related` resolved to real titles via the bundle. */
      relatedPages: RelatedPageLink[]
      /** The matched personalized-feed item (by `paperKey`), if this paper is
       * still in the cached feed — carries the full why-this/you/now, which
       * only renders here (the feed card itself no longer shows them). */
      feedItem?: FeedItem
    }

/**
 * Resolves the full "ready" load state for a slug: paper record, page state,
 * and everything the saved-state view needs off the paper page's own
 * frontmatter (tldr/tags/related, resolved to titles) plus the matched feed
 * item's why-lines. Shared by the initial load and by the post-Save/
 * post-Enrich reloads so all three stay in lockstep with the same logic.
 */
async function loadReadyState(storage: VaultStorage, slug: string): Promise<LoadState> {
  const [paper, bundle, feed] = await Promise.all([resolvePaperBySlug(storage, slug), loadBundle(storage), loadFeed(storage)])
  if (!paper) return { status: "not-found" }

  const pageState = resolvePaperPageState(bundle, slug)
  const page = bundle.pages.get(`wiki/papers/${slug}`)
  const fullTextKnownFalse = page?.frontmatter.full_text === false
  // A paper resolved from a wiki page's frontmatter (rather than the feed
  // cache) never carries an abstract — paperRecordFromFrontmatter only
  // reads frontmatter, and the abstract lives in the page BODY under "##
  // Abstract" (see buildPaperPage). Backfill it here the same way
  // /api/skills/enrich does, so a saved/ingested paper's page still shows
  // its abstract instead of silently dropping the section.
  const paperWithAbstract = !paper.abstract && page ? { ...paper, abstract: extractAbstractFromBody(page.body) } : paper

  const tldr = page && typeof page.frontmatter.tldr === "string" ? page.frontmatter.tldr : undefined
  const tags = page?.frontmatter.tags
  const relatedPages = resolveRelatedPages(bundle, page?.frontmatter.related)
  const feedItem = feed?.items.find((it) => paperKey(it.paper) === paperKey(paperWithAbstract))

  return {
    status: "ready",
    storage,
    paper: paperWithAbstract,
    pageState,
    fullTextKnownFalse,
    tldr,
    tags,
    relatedPages,
    feedItem,
  }
}

function PaperPageContent() {
  const params = useParams()
  const router = useRouter()
  // Post-ingest celebration (M7), same as /papers — re-evaluate the
  // companion right after a successful ingest without waiting for a route change.
  const reevaluateCompanion = useCompanion()

  const rawKey = params?.key
  const slug = Array.isArray(rawKey) ? (rawKey[0] ?? "") : (rawKey ?? "")

  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [digestState, setDigestState] = useState<DigestState>({ status: "idle" })
  const [ingestState, setIngestState] = useState<IngestState>({ phase: "idle" })
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" })
  const [enrichState, setEnrichState] = useState<EnrichState>({ status: "idle" })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!slug) {
        if (!cancelled) setLoad({ status: "not-found" })
        return
      }
      setLoad({ status: "loading" })
      setDigestState({ status: "idle" })
      setIngestState({ phase: "idle" })
      setSaveState({ status: "idle" })
      setEnrichState({ status: "idle" })
      const storage = await getOpenVault()
      const next = await loadReadyState(storage, slug)
      if (cancelled) return
      setLoad(next)
      if (next.status === "ready") {
        void logEvent(storage, { type: "paper_view", paperKey: paperKey(next.paper), title: next.paper.title })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  async function handleGenerateDigest() {
    if (load.status !== "ready") return
    const { paper, storage } = load
    setDigestState({ status: "loading" })
    try {
      const { digest, fromCache, costUsd } = await generateDigestRemote(paper)
      setDigestState({ status: "done", digest, fromCache, costUsd })
      if (!fromCache) {
        void logEvent(storage, { type: "digest_generated", paperKey: paperKey(paper), title: paper.title, costUsd })
      }
    } catch (err) {
      setDigestState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleIngest() {
    if (load.status !== "ready") return
    const { paper, storage } = load
    setIngestState({ phase: "acquiring" })
    try {
      const { output, costUsd } = await ingestRemote(paper, (phase) => setIngestState({ phase }))
      setIngestState({ phase: "done", output, costUsd })
      if (output.status === "ok") {
        // Awaited (not fire-and-forget) so the ingest event is durably logged
        // before the companion re-evaluates — mirrors /papers's handleIngest.
        await logEvent(storage, {
          type: "ingest",
          paperKey: paperKey(paper),
          title: paper.title,
          changesetId: output.changesetId,
        })
        reevaluateCompanion()
      }
    } catch (err) {
      setIngestState({ phase: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleUndo() {
    if (ingestState.phase !== "done" || ingestState.output.status !== "ok") return
    const changesetId = ingestState.output.changesetId
    setIngestState({ ...ingestState, undoing: true })
    try {
      await undoIngestRemote(changesetId)
      setIngestState((prev) => (prev.phase === "done" ? { ...prev, undoing: false, undone: true } : prev))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setIngestState((prev) => (prev.phase === "done" ? { ...prev, undoing: false, undoError: message } : prev))
    }
  }

  async function handleSave() {
    if (load.status !== "ready") return
    const { paper, storage } = load
    setSaveState({ status: "saving" })
    try {
      const { saved } = await savePaper(storage, paper)
      setSaveState({ status: "done", alreadySaved: !saved })
      // Reload so pageState flips discovery -> saved immediately (the tier-1
      // stub write already landed by the time savePaper resolves — the
      // tier-2 enrich it also kicks off in the background hasn't, so tldr/
      // tags/related may still be empty until a later reload or Enrich click).
      setLoad(await loadReadyState(storage, slug))
    } catch (err) {
      setSaveState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleEnrich() {
    if (load.status !== "ready") return
    const { storage } = load
    setEnrichState({ status: "loading" })
    const result = await enrichRemote(slug)
    // Re-fetch the bundle so the freshly-merged tldr/tags/related render
    // before dropping the "Enriching…" state, regardless of whether this run
    // applied anything.
    setLoad(await loadReadyState(storage, slug))
    setEnrichState({ status: "done", applied: result.applied })
  }

  function handleReadFullText() {
    if (load.status !== "ready") return
    router.push(`/reader?paperKey=${encodeURIComponent(paperKey(load.paper))}`)
  }

  if (load.status === "loading") {
    return (
      <div className="p-7">
        <LoadingState />
      </div>
    )
  }

  if (load.status === "not-found") {
    return (
      <div className="p-7">
        <EmptyState
          title="Paper not found"
          hint="It isn't in your feed cache or knowledge base yet — search for it on the Papers page."
          action={
            <Link href="/papers" className="text-[13px] text-orange hover:text-orange-light">
              ← Back to papers
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-7">
      <Link href="/papers" className="mb-4 inline-block text-[13px] text-muted-text hover:text-espresso transition-colors">
        ← Back to papers
      </Link>

      <PaperHeader paper={load.paper} />

      <PaperActions
        pageState={load.pageState}
        fullTextKnownFalse={load.fullTextKnownFalse}
        saveState={saveState}
        onSave={handleSave}
        enrichState={enrichState}
        onEnrich={handleEnrich}
        digestState={digestState}
        onGenerateDigest={handleGenerateDigest}
        ingestState={ingestState}
        onIngest={handleIngest}
        onUndo={handleUndo}
        onReadFullText={handleReadFullText}
      />

      {load.pageState.state === "saved" && (
        <>
          <PaperMeta tldr={load.tldr} tags={load.tags} />
          <RelatedInWiki related={load.relatedPages} />
          {load.feedItem && (
            <Card className="mt-4 p-5">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-text">Why this is in your feed</div>
              <div className="space-y-2 text-[14px] leading-[1.6] text-espresso tracking-body">
                <p>
                  <span className="font-medium">Why this: </span>
                  {load.feedItem.whyThis}
                </p>
                <p>
                  <span className="font-medium">Why you: </span>
                  {load.feedItem.whyYou}
                </p>
                <p>
                  <span className="font-medium">Why now: </span>
                  {load.feedItem.whyNow}
                </p>
              </div>
            </Card>
          )}
        </>
      )}

      {digestState.status === "done" && <PaperDigestView digest={digestState.digest} fromCache={digestState.fromCache} />}
    </div>
  )
}

export default function PaperPage() {
  return (
    <Suspense
      fallback={
        <div className="p-7">
          <LoadingState />
        </div>
      }
    >
      <PaperPageContent />
    </Suspense>
  )
}
