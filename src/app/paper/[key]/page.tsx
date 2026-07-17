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
import { logEvent } from "@/lib/events/log"
import type { VaultStorage } from "@/lib/vault/storage"
import { PaperHeader } from "@/components/paper/PaperHeader"
import { PaperActions, type DigestState, type IngestState, type SaveState } from "@/components/paper/PaperActions"
import { PaperDigestView } from "@/components/paper/PaperDigestView"
import { useCompanion } from "@/components/companion/useCompanion"
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
      const storage = await getOpenVault()
      const [paper, bundle] = await Promise.all([resolvePaperBySlug(storage, slug), loadBundle(storage)])
      if (cancelled) return
      if (!paper) {
        setLoad({ status: "not-found" })
        return
      }
      const pageState = resolvePaperPageState(bundle, slug)
      const page = bundle.pages.get(`wiki/papers/${slug}`)
      const fullTextKnownFalse = page?.frontmatter.full_text === false
      // A paper resolved from a wiki page's frontmatter (rather than the feed
      // cache) never carries an abstract — paperRecordFromFrontmatter only
      // reads frontmatter, and the abstract lives in the page BODY under "##
      // Abstract" (see buildPaperPage). Backfill it here the same way
      // /api/skills/enrich does, so a saved/ingested paper's page still shows
      // its abstract instead of silently dropping the section.
      const paperWithAbstract =
        !paper.abstract && page ? { ...paper, abstract: extractAbstractFromBody(page.body) } : paper
      setLoad({ status: "ready", storage, paper: paperWithAbstract, pageState, fullTextKnownFalse })
      void logEvent(storage, { type: "paper_view", paperKey: paperKey(paperWithAbstract), title: paperWithAbstract.title })
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
    } catch (err) {
      setSaveState({ status: "error", message: err instanceof Error ? err.message : String(err) })
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
        digestState={digestState}
        onGenerateDigest={handleGenerateDigest}
        ingestState={ingestState}
        onIngest={handleIngest}
        onUndo={handleUndo}
        onReadFullText={handleReadFullText}
      />

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
