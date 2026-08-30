"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import type { SurfaceSelection } from "./HtmlSurface"
import HighlightLayer from "./HighlightLayer"
import AskableSurface from "./AskableSurface"
import type { ReaderContent } from "@/lib/reader/load"
import { paperKey, type PaperRecord } from "@/lib/papers/types"
import { originalPaperUrl } from "@/lib/papers/source-link"
import { paperSlug } from "@/lib/wiki/authoring"
import { displayTitle } from "@/lib/papers/title"
import type { VaultStorage } from "@/lib/vault/storage"
import type { Highlight } from "@/lib/highlights/types"
import { listHighlights, listHighlightsWithRetry, addHighlight, removeHighlight, makeHighlightId } from "@/lib/highlights/store"
import { createAnchor } from "@/lib/highlights/anchor"
import { loadBundle } from "@/lib/vault/bundle"
import { logEvent } from "@/lib/events/log"

// pdf.js and DOMPurify both touch DOMMatrix/canvas/window and must never run
// during SSR — both surfaces are client-only, per the M6 plan's SSR
// constraint for this task (Task 8's "CRITICAL integration guidance").
const HtmlSurface = dynamic(() => import("./HtmlSurface"), { ssr: false })
const PdfSurface = dynamic(() => import("./PdfSurface"), { ssr: false })

/**
 * The URL the paper's HTML originally came from, for figure-src resolution
 * (see `buildFigureSrcResolver`): a fresh acquire carries it on the content;
 * a snapshot-hit doesn't, so fall back to the paper record's own htmlUrl,
 * then to the arXiv-id-derived HTML home (the snapshot's own `<base href>`
 * supplies the exact versioned path — only the origin needs to be right).
 * Undefined ⇒ figures stay placeholders, never a wrong-host fetch.
 */
function figureSourceUrl(content: ReaderContent, paper: PaperRecord): string | undefined {
  if (content.kind !== "html") return undefined
  if (content.sourceUrl) return content.sourceUrl
  if (paper.htmlUrl) return paper.htmlUrl
  if (paper.ids.arxiv) return `https://arxiv.org/html/${paper.ids.arxiv}`
  return undefined
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
 * DOM root and persisted highlights. Mounts `HtmlSurface` or `PdfSurface`
 * depending on `content.kind`, wrapped in `AskableSurface` (Task 7 extract)
 * for the select→ask and select→capture-idea flows; `kind: "none"` renders a
 * centered handoff to the paper's canonical external source.
 */
export default function ReaderView({ paper, content, storage }: ReaderViewProps) {
  const key = paperKey(paper)

  const [surfaceText, setSurfaceText] = useState("")
  const [surfaceRoot, setSurfaceRoot] = useState<HTMLElement | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [sourcePageId, setSourcePageId] = useState<string | undefined>(undefined)
  const addingHighlightRef = useRef(false)

  // Read from a ref inside async handlers so a stale closure over an earlier
  // render's `surfaceText` can never anchor against outdated text.
  const surfaceTextRef = useRef(surfaceText)
  useEffect(() => {
    surfaceTextRef.current = surfaceText
  }, [surfaceText])

  // Once on mount: load this paper's persisted highlights, log reader_open,
  // and best-effort resolve its own wiki page id (for capture-idea's
  // related[] link, threaded down into AskableSurface).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Retrying load: a single transient fetch failure (e.g. dev server
      // mid-restart) must not leave the whole session with zero highlights.
      const existing = await listHighlightsWithRetry(storage, key)
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

  // Select→ask and select→capture-idea live in AskableSurface now (Task 7);
  // this component keeps only the persistent-highlight concerns: the
  // HighlightLayer + its add/remove handlers. `sel` is the selection
  // AskableSurface's bubble snapshotted at the moment Highlight was clicked
  // (its own live selection is already cleared by the time this fires).
  async function handleHighlight(sel: SurfaceSelection) {
    // Synchronous re-entrancy guard: a double-click fires two onClicks in the
    // same render, both closing over the same (stale, pre-flush) selection —
    // without this the same passage would be added twice.
    if (addingHighlightRef.current) return
    let anchor
    try {
      anchor = createAnchor(surfaceTextRef.current, sel.start, sel.end)
    } catch {
      return
    }
    addingHighlightRef.current = true
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

  if (content.kind === "none") {
    const sourceUrl = originalPaperUrl(paper)
    return (
      <main className="flex min-h-[calc(100dvh-2rem)] items-center justify-center px-5 py-12 sm:px-8">
        <section aria-labelledby="reader-unavailable-title" className="w-full max-w-[720px] text-center">
          <h1
            id="reader-unavailable-title"
            className="font-heading text-[32px]/[1.16] tracking-heading text-espresso sm:text-[40px]/[1.12]"
          >
            Full text is not available inside SciSpark
          </h1>

          <p className="mx-auto mt-5 max-w-[58ch] text-[15px]/[1.7] tracking-body text-muted-text">
            SciSpark could not retrieve a readable open-access copy. The original paper may still be available
            through your institution or from the publisher.
          </p>

          <p className="mx-auto mt-7 max-w-[52ch] font-heading text-[20px]/[1.35] tracking-heading-card text-espresso">
            {displayTitle(paper.title)}
          </p>

          <div className="mt-8 flex flex-col items-center gap-4">
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open original paper in a new tab"
                className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-pill bg-orange px-5 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-orange/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2"
              >
                Open original paper
              </a>
            )}

            {/* SP2 moved the digest onto the paper page and slimmed /papers to
                search-only, so return to the paper detail rather than /papers. */}
            <Link
              href={`/paper/${paperSlug(paper)}`}
              className="text-[13px] text-muted-text underline decoration-border-warm underline-offset-4 transition-colors hover:text-orange"
            >
              Back to paper details
            </Link>
          </div>

          {!sourceUrl && (
            <p className="mx-auto mt-6 max-w-[48ch] text-[13px]/[1.6] tracking-body text-muted-text">
              This record does not include a verified external source link.
            </p>
          )}
        </section>
      </main>
    )
  }

  return (
    <AskableSurface
      storage={storage}
      paper={paper}
      sourcePageId={sourcePageId}
      surfaceText={surfaceText}
      enableHighlight
      onHighlight={(sel) => void handleHighlight(sel)}
    >
      {({ onHtmlSelectionChange, onPdfSelect, askPanel }) => (
        <div className="flex h-full min-h-0">
          <div className="flex-1 min-w-0 overflow-y-auto p-7">
            <h1 className="font-heading text-[22px] text-espresso tracking-heading mb-4 max-w-[68ch]">{displayTitle(paper.title)}</h1>

            {content.kind === "html" && (
              <div className="relative">
                <HtmlSurface
                  html={content.html}
                  sourceUrl={figureSourceUrl(content, paper)}
                  onPlainText={setSurfaceText}
                  onSelectionChange={onHtmlSelectionChange}
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
                onSelect={onPdfSelect}
                renderHighlights={() =>
                  highlights.length > 0 ? (
                    <div className="absolute top-2 right-2 rounded-pill border border-border-warm bg-light-surface px-2.5 py-1 text-[11px] text-muted-text shadow-sm">
                      {highlights.length} highlight{highlights.length === 1 ? "" : "s"} saved (not shown on PDF yet)
                    </div>
                  ) : null
                }
              />
            )}
          </div>

          <div className="w-[340px] flex-shrink-0">{askPanel}</div>
        </div>
      )}
    </AskableSurface>
  )
}
