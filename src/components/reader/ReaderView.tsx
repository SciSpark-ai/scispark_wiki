"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import type { SurfaceSelection } from "./HtmlSurface"
import SelectionBubble from "./SelectionBubble"
import HighlightLayer from "./HighlightLayer"
import AskPanel, { type AskState } from "./AskPanel"
import type { ReaderContent } from "@/lib/reader/load"
import { paperKey, type PaperRecord } from "@/lib/papers/types"
import type { VaultStorage } from "@/lib/vault/storage"
import type { Highlight } from "@/lib/highlights/types"
import { listHighlights, addHighlight, removeHighlight, makeHighlightId } from "@/lib/highlights/store"
import { createAnchor } from "@/lib/highlights/anchor"
import { captureIdeaAsNote } from "@/lib/reader/capture-idea"
import { buildAskContext } from "@/lib/reader/ask-context"
import { readingCompanionSkill } from "@/lib/skills/reading-companion"
import { runSkill } from "@/lib/skills/runner"
import { loadSettings } from "@/lib/llm/settings"
import { loadCompanionSettings } from "@/lib/companion/settings"
import { loadBundle } from "@/lib/vault/bundle"
import { logEvent } from "@/lib/events/log"

// pdf.js and DOMPurify both touch DOMMatrix/canvas/window and must never run
// during SSR — both surfaces are client-only, per the M6 plan's SSR
// constraint for this task (Task 8's "CRITICAL integration guidance").
const HtmlSurface = dynamic(() => import("./HtmlSurface"), { ssr: false })
const PdfSurface = dynamic(() => import("./PdfSurface"), { ssr: false })

/** How much plain text on each side of a selection is sent as "surrounding"
 * context to the Reading-Companion skill (already truncated here, per
 * ReadingCompanionInput's own doc comment). */
const SURROUND_RADIUS = 800

interface PendingSelection {
  start: number
  end: number
  text: string
  rectTop: number
  rectLeft: number
}

function computeSurroundingText(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SURROUND_RADIUS)
  const to = Math.min(text.length, end + SURROUND_RADIUS)
  return text.slice(from, to)
}

/** wiki page id (e.g. "wiki/papers/foo") -> its /wiki/<...> route, matching
 * the pageHref convention in src/app/papers/page.tsx. */
function pageHref(idOrPath: string): string {
  return `/wiki/${idOrPath.replace(/\.md$/, "")}`
}

/**
 * Best-effort lookup of this paper's own wiki page id (if it has been
 * ingested), for capture-idea's `related[]` link. Reconstructs a comparable
 * `PaperRecord` from each `type: paper` page's frontmatter ids, the same
 * shape `paperKey` normalizes — mirrors `paperKeyFromFrontmatter` in
 * src/lib/skills/feed.ts (not exported, so re-derived here rather than
 * taking a cross-module dependency on a private helper).
 */
async function findSourcePageId(storage: VaultStorage, targetKey: string): Promise<string | undefined> {
  try {
    const bundle = await loadBundle(storage)
    for (const page of bundle.pages.values()) {
      if (page.frontmatter.type !== "paper") continue
      const fm = page.frontmatter
      const candidate: PaperRecord = {
        ids: {
          doi: typeof fm.doi === "string" ? fm.doi : undefined,
          arxiv: typeof fm.arxiv === "string" ? fm.arxiv : undefined,
          openalex: typeof fm.openalex === "string" ? fm.openalex : undefined,
          pmid: typeof fm.pmid === "string" ? fm.pmid : undefined,
        },
        title: typeof fm.title === "string" ? fm.title : "",
        authors: [],
        fields: [],
        source: "arxiv",
      }
      if (paperKey(candidate) === targetKey) return page.id
    }
  } catch {
    // Best-effort — capture-idea still works without a related[] link.
  }
  return undefined
}

export interface ReaderViewProps {
  paper: PaperRecord
  content: ReaderContent
  storage: VaultStorage
}

/**
 * Owns the reader's client-side state: the mounted surface's plain text +
 * DOM root, persisted highlights, the current pending selection, and the
 * Ask panel's conversation state. Mounts `HtmlSurface` or `PdfSurface`
 * depending on `content.kind`; `kind: "none"` renders an
 * abstract-plus-back-link card instead (M6 plan Task 8).
 */
export default function ReaderView({ paper, content, storage }: ReaderViewProps) {
  const key = paperKey(paper)

  const [surfaceText, setSurfaceText] = useState("")
  const [surfaceRoot, setSurfaceRoot] = useState<HTMLElement | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null)
  const [askTarget, setAskTarget] = useState<PendingSelection | null>(null)
  const [sourcePageId, setSourcePageId] = useState<string | undefined>(undefined)
  const addingHighlightRef = useRef(false)
  const [askState, setAskState] = useState<AskState>({ status: "idle" })
  const [captureNotice, setCaptureNotice] = useState<{ path: string } | null>(null)

  // Read from a ref inside async handlers so a stale closure over an earlier
  // render's `surfaceText` can never anchor/ask against outdated text.
  const surfaceTextRef = useRef(surfaceText)
  useEffect(() => {
    surfaceTextRef.current = surfaceText
  }, [surfaceText])

  // Once on mount: load this paper's persisted highlights, log reader_open,
  // and best-effort resolve its own wiki page id (for capture-idea's
  // related[] link).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const existing = await listHighlights(storage, key)
      if (!cancelled) setHighlights(existing)

      void logEvent(storage, { type: "reader_open", paperKey: key, title: paper.title })

      const resolved = await findSourcePageId(storage, key)
      if (!cancelled) setSourcePageId(resolved)
    })()
    return () => {
      cancelled = true
    }
    // storage/key/paper.title are stable for the lifetime of one reader session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setPendingSelection(null)
  }, [])

  const handleHtmlSelectionChange = useCallback((selection: SurfaceSelection | null) => {
    setPendingSelection(selection)
  }, [])

  const handlePdfSelect = useCallback((start: number, end: number, selectedText: string) => {
    // pdf.js's own native selection is still live at this point (this fires
    // synchronously from PdfSurface's mouseup handler), so the same rect the
    // browser is showing can still be read here for the bubble's position.
    const rect = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect()
    setPendingSelection({
      start,
      end,
      text: selectedText,
      rectTop: rect?.top ?? 0,
      rectLeft: rect?.left ?? 0,
    })
  }, [])

  async function handleHighlight() {
    // Synchronous re-entrancy guard: a double-click fires two onClicks in the
    // same render, both closing over the same pendingSelection — without this
    // the same passage would be added twice.
    if (addingHighlightRef.current) return
    const sel = pendingSelection
    if (!sel) return
    let anchor
    try {
      anchor = createAnchor(surfaceTextRef.current, sel.start, sel.end)
    } catch {
      clearSelection()
      return
    }
    addingHighlightRef.current = true
    clearSelection()
    const highlight: Highlight = {
      id: makeHighlightId(),
      anchor,
      color: "yellow",
      note: "",
      createdTs: new Date().toISOString(),
    }
    try {
      await addHighlight(storage, key, highlight)
      setHighlights(await listHighlights(storage, key))
      void logEvent(storage, { type: "highlight_add", paperKey: key, title: paper.title })
    } finally {
      addingHighlightRef.current = false
    }
  }

  async function handleRemoveHighlight(id: string) {
    await removeHighlight(storage, key, id)
    setHighlights(await listHighlights(storage, key))
  }

  // Snapshot the passage the user invoked "Ask" on into a target that persists
  // independently of the live selection. Clicking into the Ask panel's question
  // box dismisses the native selection (clearing pendingSelection), so the
  // typed-question flow must not depend on pendingSelection still being set.
  function beginAsk() {
    if (!pendingSelection) return
    setAskTarget(pendingSelection)
    void runAsk(pendingSelection, "")
  }

  function submitAskQuestion(question: string) {
    if (!askTarget) return
    void runAsk(askTarget, question)
  }

  async function runAsk(target: PendingSelection, question: string) {
    setAskState({ status: "loading" })
    try {
      const context = await buildAskContext(storage, {
        paper,
        selection: target.text,
        surroundingText: computeSurroundingText(surfaceTextRef.current, target.start, target.end),
        userQuestion: question,
      })
      const [settings, companionSettings] = await Promise.all([
        loadSettings(storage),
        loadCompanionSettings(storage),
      ])
      const run = await runSkill({
        skill: readingCompanionSkill,
        input: { ...context, companionName: companionSettings.companionName },
        storage,
        settings,
      })
      if (run.status === "ok" && run.output !== undefined) {
        setAskState({ status: "done", answer: run.output.answer, citedPageIds: run.output.citedPageIds })
        void logEvent(storage, { type: "reading_ask", paperKey: key })
      } else {
        setAskState({
          status: "error",
          message: run.error ?? `reading-companion run finished with unexpected status "${run.status}"`,
        })
      }
    } catch (err) {
      setAskState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleCapture() {
    if (!pendingSelection) return
    const thought = window.prompt("Add a thought (optional):", "") ?? ""
    const selectionText = pendingSelection.text
    clearSelection()
    try {
      const { path } = await captureIdeaAsNote({
        storage,
        paperKey: key,
        paperTitle: paper.title,
        sourcePageId,
        selection: selectionText,
        thought,
        today: new Date().toISOString().slice(0, 10),
      })
      setCaptureNotice({ path })
    } catch {
      // Best-effort UI notice only: applyChangeset is all-or-nothing, so a
      // throw here means nothing was partially written.
    }
  }

  if (content.kind === "none") {
    return (
      <div className="p-7">
        <div className="border border-border-warm rounded-card px-4 py-3 bg-light-surface max-w-2xl">
          <h1 className="font-heading text-[20px] text-espresso tracking-heading-card">{paper.title}</h1>
          <div className="mt-2 text-[13px] text-muted-text tracking-body">{content.reason}</div>
          {paper.abstract && (
            <div className="mt-3 text-[13px]/[19px] text-espresso whitespace-pre-wrap">{paper.abstract}</div>
          )}
          <Link
            href={`/papers?paperKey=${encodeURIComponent(key)}`}
            className="mt-3 inline-block text-[13px] text-orange hover:text-orange-light"
          >
            Back to digest
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 overflow-y-auto p-7">
        <h1 className="font-heading text-[22px] text-espresso tracking-heading mb-4 max-w-[68ch]">{paper.title}</h1>

        {content.kind === "html" && (
          <div className="relative">
            <HtmlSurface
              html={content.html}
              onPlainText={setSurfaceText}
              onSelectionChange={handleHtmlSelectionChange}
              onContainerReady={setSurfaceRoot}
            />
            <HighlightLayer
              surfaceRoot={surfaceRoot}
              surfaceText={surfaceText}
              highlights={highlights}
              onClickHighlight={(id) => void handleRemoveHighlight(id)}
            />
          </div>
        )}

        {content.kind === "pdf" && (
          // Persistent highlight PAINTING on the multi-page PDF text layer is
          // explicitly out of scope for M6 (the anchor/offset model doesn't
          // map cleanly onto pdf.js's per-page text layers) — selection ->
          // Highlight/Ask/Capture actions still work below; this surface just
          // shows a count instead of painted rects. See the M6 plan's
          // Self-Review Notes ("Deferred") and Task 8's integration guidance.
          <PdfSurface
            bytes={content.bytes}
            onPlainText={setSurfaceText}
            onSelect={handlePdfSelect}
            renderHighlights={() =>
              highlights.length > 0 ? (
                <div className="absolute top-2 right-2 rounded-pill border border-border-warm bg-light-surface px-2.5 py-1 text-[11px] text-muted-text shadow-sm">
                  {highlights.length} highlight{highlights.length === 1 ? "" : "s"} saved (not shown on PDF yet)
                </div>
              ) : null
            }
          />
        )}

        <SelectionBubble
          selection={pendingSelection}
          onAsk={beginAsk}
          onHighlight={() => void handleHighlight()}
          onCapture={() => void handleCapture()}
        />

        {captureNotice && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 border border-border-warm rounded-pill bg-espresso text-white px-4 py-2 text-[13px] shadow-lg flex items-center gap-2 z-50">
            Idea captured.
            <Link href={pageHref(captureNotice.path)} className="text-orange-light font-medium">
              View note
            </Link>
          </div>
        )}
      </div>

      <div className="w-[340px] flex-shrink-0">
        <AskPanel selectionText={askTarget?.text ?? null} state={askState} onAsk={submitAskQuestion} />
      </div>
    </div>
  )
}
