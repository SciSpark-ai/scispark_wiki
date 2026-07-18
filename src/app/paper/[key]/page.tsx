"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { resolvePaperBySlug, extractAbstractFromBody } from "@/lib/papers/resolve"
import { findPaperPage, pageStateFromPage, isFullTextKnownUnavailable, type PaperPageState } from "@/lib/papers/page-state"
import { paperKey, type PaperRecord } from "@/lib/papers/types"
import { savePaper } from "@/lib/papers/save-client"
import { generateDigestRemote, ingestRemote, undoIngestRemote } from "@/lib/skills/ingest-client"
import { enrichRemote } from "@/lib/skills/enrich-client"
import { loadFeed, type FeedItem } from "@/lib/skills/feed"
import { logEvent } from "@/lib/events/log"
import type { VaultStorage } from "@/lib/vault/storage"
import { rangeToOffsets, plainTextOf } from "@/lib/reader/dom-offsets"
import type { SurfaceSelection } from "@/components/reader/HtmlSurface"
import AskableSurface from "@/components/reader/AskableSurface"
import { PaperHeader } from "@/components/paper/PaperHeader"
import { PaperActions, type DigestState, type EnrichState, type IngestState, type SaveState } from "@/components/paper/PaperActions"
import { PaperDigestView } from "@/components/paper/PaperDigestView"
import { PaperMeta } from "@/components/paper/PaperMeta"
import { PaperSynthesis } from "@/components/paper/PaperSynthesis"
import { RelatedInWiki, resolveRelatedPages, type RelatedPageLink } from "@/components/paper/RelatedInWiki"
import { useCompanion } from "@/components/companion/useCompanion"
import { Button } from "@/components/ui/Button"
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
      /** The loaded wiki bundle — kept on load state (rather than reloaded)
       * so the ingested-state synthesis/backlinks render against the exact
       * same snapshot `pageState`/`tldr`/`relatedPages` were derived from. */
      bundle: Bundle
      /** True only when the paper page is INGESTED and its own frontmatter
       * has confirmed no full text was acquired (C1) — a saved-but-not-yet-
       * ingested stub never carries `full_text` at all, so its absence
       * leaves "Read full text" enabled rather than reading as a known
       * paywall. See `isFullTextKnownUnavailable`. */
      fullTextKnownFalse: boolean
      /** Tier-2 Enrich Skill output off the paper page's own frontmatter
       * (`tldr`/`tags`) — absent until the paper's been enriched. */
      tldr?: string
      tags?: string[]
      /** `frontmatter.related` resolved to real titles via the bundle. */
      relatedPages: RelatedPageLink[]
      /** The matched personalized-feed item (by `paperKey`), if this paper is
       * still in the cached feed — carries the full why-this/you/now. The
       * feed card will stop showing these once the SP2 feed-card redesign
       * (Task 12) lands; until then they render in both places. */
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

  // I2: routing-tolerant lookup (findPaperPage scans for type:"paper" by id
  // suffix) rather than a hardcoded "wiki/papers/<slug>" path, so a
  // schema.md-routed vault's paper page still resolves past "discovery".
  const page = findPaperPage(bundle, slug)
  const pageState = pageStateFromPage(page)
  const fullTextKnownFalse = isFullTextKnownUnavailable(page)
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
    bundle,
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

  // Ask-anywhere (Task 11): unlike the reader, this page has no dedicated
  // HtmlSurface/PdfSurface — its content is plain rendered React, not a
  // dangerouslySetInnerHTML region. So selection tracking is reimplemented
  // here at the same level HtmlSurface does it (rangeToOffsets/plainTextOf
  // over a ref'd container), instead of via that component. `contentRef`
  // wraps the ENTIRE content region (header/actions/meta/synthesis/digest —
  // "select anywhere on the page" per the brief), and doubles as the text
  // AskableSurface's `surfaceText` is measured against, so selection offsets
  // and ask "surrounding text" offsets always agree.
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [surfaceText, setSurfaceText] = useState("")
  const [askOpen, setAskOpen] = useState(false)
  // The drawer opens from a text selection elsewhere on the page, so focus
  // is never inside it by default — without moving focus in, a bubbled
  // keydown Escape handler on the drawer would never fire. Focused once on
  // open (not a loop/trap: Tab from here moves on normally), so Escape
  // reliably closes the drawer as soon as it appears.
  const askDrawerRef = useRef<HTMLDivElement | null>(null)
  // AskableSurface only hands back its (stable) onHtmlSelectionChange inside
  // a render-prop callback invoked during render, not as a normal prop — so
  // it's captured into a ref (assigned each render, read only from the
  // selection handler below) rather than a state/effect-synced value.
  const onSelectionChangeRef = useRef<(selection: SurfaceSelection | null) => void>(() => {})

  const handleSelection = useCallback(() => {
    const container = contentRef.current
    if (!container) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      onSelectionChangeRef.current(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return
    const offsets = rangeToOffsets(container, range)
    if (!offsets) {
      onSelectionChangeRef.current(null)
      return
    }
    const rect = range.getBoundingClientRect()
    const text = plainTextOf(container)
    // Refreshed on every completed selection (rather than via a separate
    // content-watching effect — this page's content is driven by several
    // independent state slices with no single dependency to key an effect
    // off, unlike HtmlSurface's own `[sanitizedHtml]`-keyed one) — sufficient
    // because AskableSurface only ever reads `surfaceText` to compute
    // "surrounding text" around a selection's own offsets, and a selection
    // must exist (this same branch) before any ask can fire.
    setSurfaceText(text)
    onSelectionChangeRef.current({
      start: offsets.start,
      end: offsets.end,
      text: text.slice(offsets.start, offsets.end),
      rectTop: rect.top,
      rectLeft: rect.left,
    })
    setAskOpen(true)
  }, [])

  // Mirrors HtmlSurface's own listener: a selection collapsed from outside
  // this page's mouseup/keyup handlers (e.g. SelectionBubble's outside-click
  // dismissal) still needs to clear pendingSelection.
  useEffect(() => {
    document.addEventListener("selectionchange", handleSelection)
    return () => document.removeEventListener("selectionchange", handleSelection)
  }, [handleSelection])

  // See askDrawerRef's doc comment: move focus into the drawer once, right
  // when it opens, so the wrapper's onKeyDown Escape handler below has
  // something to bubble from.
  useEffect(() => {
    if (askOpen) askDrawerRef.current?.focus()
  }, [askOpen])

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
      // A navigation between two /paper/[key] routes reuses this same
      // component instance (no remount) — without this, an open Ask drawer
      // (and the selection/answer it's showing) would keep displaying the
      // PREVIOUS paper's content after switching papers.
      setAskOpen(false)
      setSurfaceText("")
      window.getSelection()?.removeAllRanges()
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
    // enrichRemote itself never throws (see enrich-client.ts), but the reload
    // below can (RemoteVaultStorage.list()/read() throw on a transient
    // non-ok /api/vault response) — wrapped exactly like handleSave's reload
    // so a failed reload un-sticks the button and surfaces a message instead
    // of leaving enrichState stuck on "loading" forever.
    try {
      const result = await enrichRemote(slug)
      // Re-fetch the bundle so the freshly-merged tldr/tags/related render
      // before dropping the "Enriching…" state, regardless of whether this run
      // applied anything.
      setLoad(await loadReadyState(storage, slug))
      setEnrichState({ status: "done", applied: result.applied })
    } catch (err) {
      setEnrichState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
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

  // The paper's own wiki page id (undefined during discovery, before any
  // page exists) — threaded into AskableSurface as `sourcePageId` for
  // capture-idea's `related[]` link, and used to look up the ingested body
  // below. Uses the same routing-tolerant `findPaperPage` lookup (I2)
  // `resolvePaperPageState`/`loadReadyState` use above, rather than a
  // hardcoded "wiki/papers/<slug>" path — so a schema.md-routed vault's
  // paper page still resolves here too.
  const page = findPaperPage(load.bundle, slug)
  const sourcePageId = page?.id

  return (
    // key={slug}: forces a fresh AskableSurface (and its internal
    // askState/askTarget/captureState) on every paper-to-paper navigation —
    // this page reuses one component instance across route param changes
    // (see the mount effect's manual resets above for this page's OWN
    // state), so without a key change a stale answer/capture card from the
    // previous paper could otherwise still be showing.
    <AskableSurface key={slug} storage={load.storage} paper={load.paper} sourcePageId={sourcePageId} surfaceText={surfaceText}>
      {({ onHtmlSelectionChange, askPanel }) => {
        // See the contentRef/handleSelection setup above: this render-prop
        // is the only place AskableSurface's (stable) selection callback is
        // available, so the latest reference is captured into a ref here
        // rather than threaded through as a prop.
        onSelectionChangeRef.current = onHtmlSelectionChange
        return (
          <>
            <div ref={contentRef} onMouseUp={handleSelection} onKeyUp={handleSelection} className="mx-auto max-w-3xl p-7">
              <Link
                href="/papers"
                className="mb-4 inline-block text-[13px] text-muted-text hover:text-espresso transition-colors"
              >
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

              {load.pageState.state === "ingested" && page && <PaperSynthesis bundle={load.bundle} page={page} />}

              {digestState.status === "done" && <PaperDigestView digest={digestState.digest} fromCache={digestState.fromCache} />}
            </div>

            {askOpen && (
              // A floating drawer rather than ReaderView's fixed sidebar —
              // this page has no two-column layout to host one. Top/bottom
              // (rather than a fixed height) anchor it so its bottom edge
              // stays clear of the companion mascot + speech bubble (both
              // fixed bottom-5 right-5, z-40) — a bubble can pop right after
              // ingest (reevaluateCompanion() above) while this drawer is
              // open, so the two must never be able to visually collide.
              // Keyboard-dismissable (Escape) per the brief, but deliberately
              // NOT a focus trap — Tab still moves focus normally.
              <div
                ref={askDrawerRef}
                role="dialog"
                aria-label="Ask panel"
                tabIndex={-1}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAskOpen(false)
                }}
                className="fixed top-24 right-6 bottom-28 z-40 w-[360px] overflow-y-auto rounded-card border border-border-warm shadow-lg outline-none"
              >
                <div className="relative min-h-full">
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setAskOpen(false)}
                    aria-label="Close ask panel"
                    className="absolute top-2 right-2 z-10"
                  >
                    Close
                  </Button>
                  {askPanel}
                </div>
              </div>
            )}
          </>
        )
      }}
    </AskableSurface>
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
