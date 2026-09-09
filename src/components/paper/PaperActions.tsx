import Link from "next/link"
import type { ReactNode } from "react"
import type { DigestResult } from "@/lib/skills/digest"
import type { IngestOutput } from "@/lib/skills/ingest"
import type { IngestPhase } from "@/lib/skills/ingest-client"
import type { PaperPageState } from "@/lib/papers/page-state"
import { wikiHref } from "@/lib/wiki/href"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { PaperSaveButton } from "./PaperSaveButton"

export type DigestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; digest: DigestResult; fromCache: boolean; costUsd?: number | null }
  | { status: "error"; message: string }

export type IngestState =
  | { phase: "idle" }
  | { phase: IngestPhase }
  | {
      phase: "done"
      output: IngestOutput
      costUsd: number | null
      undoing?: boolean
      undone?: boolean
      undoError?: string
    }
  | { phase: "error"; message: string }

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "done"; alreadySaved: boolean }
  | { status: "error"; message: string }

/**
 * Enrich is AUTOMATIC-ONLY (Tong, 2026-07-19): there is no Enrich button —
 * the paper page fires the tier-2 skill itself whenever it shows a saved
 * paper that has no TL;DR yet (see the auto-enrich effect in
 * `/paper/[key]/page.tsx`). This state drives only a quiet "Summarizing…"
 * status line and an error line.
 */
export type EnrichState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; applied: boolean }
  | { status: "error"; message: string }

const INGEST_PHASE_LABEL: Record<IngestPhase, string> = {
  acquiring: "Acquiring full text…",
  snapshotting: "Snapshotting source…",
  digesting: "Generating digest…",
  ingesting: "Ingesting into wiki…",
}

export interface PaperActionsProps {
  pageState: PaperPageState
  /** True only once a paper page's frontmatter has confirmed no full text
   * was acquired — undefined/false (not yet known, or known available)
   * leaves "Read full text" enabled. */
  fullTextKnownFalse: boolean
  saveState: SaveState
  onSave: () => void
  enrichState: EnrichState
  digestState: DigestState
  onGenerateDigest: () => void
  ingestState: IngestState
  onIngest: () => void
  onUndo: () => void
  onReadFullText: () => void
  feedback?: ReactNode
}

/**
 * State-aware action row for `/paper/[key]`. Discovery state (no wiki page
 * yet) shows the full row: Save · Generate digest · Add to knowledge base ·
 * Read full text. Saved state collapses Save into a "Saved" chip; the
 * tier-2 enrich runs automatically (no button — see `EnrichState`'s doc
 * comment), surfacing here only as a quiet status/error line. Ingested
 * collapses both Save and Add-to-KB into a single status chip.
 */
export function PaperActions({
  pageState,
  fullTextKnownFalse,
  saveState,
  onSave,
  enrichState,
  digestState,
  onGenerateDigest,
  ingestState,
  onIngest,
  onUndo,
  onReadFullText,
  feedback,
}: PaperActionsProps) {
  const ingestBusy =
    ingestState.phase === "acquiring" ||
    ingestState.phase === "snapshotting" ||
    ingestState.phase === "digesting" ||
    ingestState.phase === "ingesting"

  const showSaveAction = pageState.state === "discovery"
  const showIngestAction = pageState.state !== "ingested"

  return (
    <div className="mt-6">
      <div role="group" aria-label="Paper actions" className="flex flex-wrap items-center gap-2">
        <PaperSaveButton saved={!showSaveAction || saveState.status === "done"} busy={saveState.status === "saving"} onSave={onSave} />
        {pageState.state === "ingested" && <Chip tone="accent">In your knowledge base</Chip>}

        <Button
          onClick={onGenerateDigest}
          disabled={digestState.status === "loading" || digestState.status === "done"}
        >
          {digestState.status === "loading"
            ? "Generating…"
            : digestState.status === "done"
              ? "Digest generated"
              : "Generate digest"}
        </Button>

        {showIngestAction && (
          <Button variant="secondary" onClick={onIngest} disabled={ingestBusy}>
            Add to knowledge base
          </Button>
        )}

        <Button variant="secondary" onClick={onReadFullText} disabled={fullTextKnownFalse}>
          Read full text
        </Button>
        {feedback && <div className="ml-auto max-w-full">{feedback}</div>}
      </div>

      {saveState.status === "error" && <LlmErrorMessage message={saveState.message} />}
      {fullTextKnownFalse && (
        <div className="mt-3 text-[13px] text-muted-text tracking-body">No open-access full text.</div>
      )}
      {enrichState.status === "loading" && (
        <div className="mt-3 text-[13px] text-muted-text tracking-body">Summarizing…</div>
      )}
      {enrichState.status === "error" && <LlmErrorMessage message={enrichState.message} />}
      {digestState.status === "error" && <LlmErrorMessage message={digestState.message} />}

      {ingestBusy && (
        <div className="mt-3 text-[13px] text-muted-text tracking-body">{INGEST_PHASE_LABEL[ingestState.phase as IngestPhase]}</div>
      )}

      {ingestState.phase === "error" && <LlmErrorMessage message={ingestState.message} />}

      {ingestState.phase === "done" && ingestState.output.status === "ok" && (
        <div className="mt-3 rounded-card border border-border-warm bg-light-surface px-4 py-3">
          <div className="text-[13px] font-medium text-espresso">Added to knowledge base</div>

          {ingestState.output.pages.created.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-text">Created</div>
              <ul className="mt-1 space-y-0.5">
                {ingestState.output.pages.created.map((path) => (
                  <li key={path}>
                    <Link href={wikiHref(path)} className="text-[13px] text-accent-ink hover:text-accent-ink-hover">
                      {path}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ingestState.output.pages.updated.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-text">Updated</div>
              <ul className="mt-1 space-y-0.5">
                {ingestState.output.pages.updated.map((path) => (
                  <li key={path}>
                    <Link href={wikiHref(path)} className="text-[13px] text-accent-ink hover:text-accent-ink-hover">
                      {path}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 text-[12px] text-muted-text tracking-body">
            {ingestState.output.reviews} review item{ingestState.output.reviews === 1 ? "" : "s"} flagged —{" "}
            <Link href="/wiki/inbox" className="text-accent-ink hover:text-accent-ink-hover">
              view inbox
            </Link>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onUndo}
              disabled={ingestState.undoing || ingestState.undone}
            >
              {ingestState.undone ? "Undone" : ingestState.undoing ? "Undoing…" : "Undo"}
            </Button>
            {ingestState.undoError && <span className="text-[12px] text-red-700">{ingestState.undoError}</span>}
          </div>
        </div>
      )}

      {ingestState.phase === "done" && ingestState.output.status === "draft" && (
        <div className="mt-3 rounded-card border border-border-warm bg-light-surface px-4 py-3">
          <div className="text-[13px] font-medium text-espresso">Generation needs review — nothing was written to the vault</div>
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-[13px] leading-[1.4] text-espresso">
            {ingestState.output.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
