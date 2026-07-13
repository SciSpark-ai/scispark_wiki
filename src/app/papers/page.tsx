"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { paperKey, type PaperRecord, type SourceId } from "@/lib/papers/types"
import { acquireFullText, snapshotSource } from "@/lib/wiki/acquire"
import { generateDigest, type DigestResult } from "@/lib/skills/digest"
import { ingestSkill, undoIngest, type IngestOutput } from "@/lib/skills/ingest"
import { runSkill } from "@/lib/skills/runner"
import { loadSettings } from "@/lib/llm/settings"
import { getOpenVault } from "@/lib/vault/get-vault"
import { PaperResultItem } from "@/components/papers/PaperResultItem"
import { DigestPanel } from "@/components/papers/DigestPanel"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"

const SOURCES: SourceId[] = ["arxiv", "openalex", "s2", "pubmed"]

type DigestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; digest: DigestResult; fromCache: boolean; costUsd?: number }
  | { status: "error"; message: string }

type IngestPhase = "acquiring" | "snapshotting" | "digesting" | "ingesting"

type IngestState =
  | { phase: "idle" }
  | { phase: IngestPhase }
  | {
      phase: "done"
      output: IngestOutput
      costUsd: number
      undoing?: boolean
      undone?: boolean
      undoError?: string
    }
  | { phase: "error"; message: string }

const INGEST_PHASE_LABEL: Record<IngestPhase, string> = {
  acquiring: "Acquiring full text…",
  snapshotting: "Snapshotting source…",
  digesting: "Generating digest…",
  ingesting: "Ingesting into wiki…",
}

/** wiki page id (e.g. "wiki/papers/foo" or "wiki/papers/foo.md") -> the /wiki/<...> route for it. */
function pageHref(idOrPath: string): string {
  const id = idOrPath.replace(/\.md$/, "")
  return `/wiki/${id}` // full id in URL: the /wiki/[...id] route joins segments back to the bundle id (e.g. /wiki/wiki/concepts/foo)
}

export default function PapersPage() {
  const [source, setSource] = useState<SourceId>("arxiv")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<PaperRecord[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [selected, setSelected] = useState<PaperRecord | null>(null)
  const [abstractExpanded, setAbstractExpanded] = useState(false)
  const [digestState, setDigestState] = useState<DigestState>({ status: "idle" })
  const [ingestState, setIngestState] = useState<IngestState>({ phase: "idle" })

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setResults(null)
    try {
      const res = await fetch(`/api/search/${source}?q=${encodeURIComponent(q)}`)
      const body = await res.json()
      if (res.ok && Array.isArray(body?.papers)) {
        setResults(body.papers as PaperRecord[])
      } else {
        setSearchError(typeof body?.error === "string" ? body.error : `search failed (status ${res.status})`)
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  function handleSelect(paper: PaperRecord) {
    setSelected(paper)
    setAbstractExpanded(false)
    setDigestState({ status: "idle" })
    setIngestState({ phase: "idle" })
  }

  async function handleGenerateDigest() {
    if (!selected) return
    setDigestState({ status: "loading" })
    try {
      const vault = await getOpenVault()
      const acquired = await acquireFullText(selected)
      const { digest, fromCache, costUsd } = await generateDigest(vault, selected, {
        fullText: acquired.kind === "html" ? acquired.text : undefined,
      })
      setDigestState({ status: "done", digest, fromCache, costUsd })
    } catch (err) {
      setDigestState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleIngest() {
    if (!selected) return
    setIngestState({ phase: "acquiring" })
    try {
      const vault = await getOpenVault()
      const acquired = await acquireFullText(selected)

      let snapshotPath: string | undefined
      if (acquired.kind === "html" && acquired.html !== undefined) {
        setIngestState({ phase: "snapshotting" })
        snapshotPath = await snapshotSource(vault, selected, acquired.html)
      }

      setIngestState({ phase: "digesting" })
      const { digest } = await generateDigest(vault, selected, {
        fullText: acquired.kind === "html" ? acquired.text : undefined,
      })

      setIngestState({ phase: "ingesting" })
      const settings = await loadSettings(vault)
      const today = new Date().toISOString().slice(0, 10)
      const run = await runSkill({
        skill: ingestSkill,
        input: {
          storage: vault,
          paper: selected,
          digest,
          fullText: { kind: acquired.kind, text: acquired.text, snapshotPath },
          today,
        },
        storage: vault,
        settings,
      })

      if (run.status === "ok" && run.output !== undefined) {
        setIngestState({ phase: "done", output: run.output, costUsd: run.costUsd })
      } else {
        setIngestState({
          phase: "error",
          message: run.error ?? `ingest run finished with unexpected status "${run.status}"`,
        })
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
      const vault = await getOpenVault()
      await undoIngest(vault, changesetId)
      setIngestState((prev) => (prev.phase === "done" ? { ...prev, undoing: false, undone: true } : prev))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setIngestState((prev) => (prev.phase === "done" ? { ...prev, undoing: false, undoError: message } : prev))
    }
  }

  const ingestBusy =
    ingestState.phase === "acquiring" ||
    ingestState.phase === "snapshotting" ||
    ingestState.phase === "digesting" ||
    ingestState.phase === "ingesting"

  return (
    <div className="p-7">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-heading text-[28px] text-espresso tracking-heading">Papers</h1>
        <Link href="/wiki/inbox" className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1">
          Review inbox
        </Link>
      </div>

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
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {searchError && (
        <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-light-surface text-[13px] text-espresso">
          {searchError}
        </div>
      )}

      <div className="mt-6 flex gap-6 items-start flex-col lg:flex-row">
        <div className="w-full lg:max-w-md flex flex-col gap-2">
          {results === null && !searching && (
            <div className="text-[13px] text-muted-text tracking-body">Search a source above to find papers.</div>
          )}
          {results !== null && results.length === 0 && (
            <div className="text-[13px] text-muted-text tracking-body">No results.</div>
          )}
          {results?.map((p, i) => (
            <PaperResultItem
              key={i}
              paper={p}
              selected={selected !== null && paperKey(selected) === paperKey(p)}
              onSelect={() => handleSelect(p)}
            />
          ))}
        </div>

        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="text-[13px] text-muted-text tracking-body">Select a result to see details.</div>
          ) : (
            <div className="border border-border-warm rounded-card px-4 py-3 bg-light-surface">
              <h2 className="font-heading text-[20px] text-espresso tracking-heading-card">{selected.title}</h2>
              <div className="mt-1 text-[12px] text-muted-text tracking-body">
                {selected.authors.map((a) => a.name).join(", ") || "Unknown authors"}
              </div>
              <div className="mt-1 text-[12px] text-muted-text tracking-body">
                {selected.year ?? "—"} · {selected.venue ?? "no venue"} · {selected.citationCount ?? 0} citations
              </div>
              <div className="mt-2">
                <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text mr-1.5">
                  {selected.source}
                </span>
                {selected.ids.doi && (
                  <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text mr-1.5">
                    doi:{selected.ids.doi}
                  </span>
                )}
                {selected.ids.arxiv && (
                  <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text mr-1.5">
                    arxiv:{selected.ids.arxiv}
                  </span>
                )}
              </div>

              {selected.abstract && (
                <div className="mt-3">
                  <div className={`text-[13px]/[14px] text-espresso ${abstractExpanded ? "" : "line-clamp-4"}`}>
                    {selected.abstract}
                  </div>
                  {selected.abstract.length > 280 && (
                    <button
                      type="button"
                      onClick={() => setAbstractExpanded((v) => !v)}
                      className="mt-1 text-[12px] text-orange font-medium"
                    >
                      {abstractExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
                {selected.oaUrl && (
                  <a href={selected.oaUrl} target="_blank" rel="noreferrer" className="text-orange hover:text-orange-light">
                    Open access
                  </a>
                )}
                {selected.pdfUrl && (
                  <a href={selected.pdfUrl} target="_blank" rel="noreferrer" className="text-orange hover:text-orange-light">
                    PDF
                  </a>
                )}
                {selected.htmlUrl && (
                  <a href={selected.htmlUrl} target="_blank" rel="noreferrer" className="text-orange hover:text-orange-light">
                    HTML
                  </a>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={handleGenerateDigest}
                  disabled={digestState.status === "loading"}
                  className="text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
                >
                  {digestState.status === "loading" ? "Generating…" : "Generate digest"}
                </button>
                <button
                  type="button"
                  onClick={handleIngest}
                  disabled={ingestBusy}
                  className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1 disabled:opacity-50"
                >
                  Add to knowledge base
                </button>
              </div>

              {digestState.status === "error" && <LlmErrorMessage message={digestState.message} />}
              {digestState.status === "done" && (
                <DigestPanel digest={digestState.digest} fromCache={digestState.fromCache} costUsd={digestState.costUsd} />
              )}

              {ingestBusy && (
                <div className="mt-3 text-[13px] text-muted-text tracking-body">
                  {INGEST_PHASE_LABEL[ingestState.phase as IngestPhase]}
                </div>
              )}

              {ingestState.phase === "error" && <LlmErrorMessage message={ingestState.message} />}

              {ingestState.phase === "done" && ingestState.output.status === "ok" && (
                <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-light-surface">
                  <div className="text-[13px] text-espresso font-medium">Added to knowledge base</div>

                  {ingestState.output.pages.created.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-text">Created</div>
                      <ul className="mt-1 space-y-0.5">
                        {ingestState.output.pages.created.map((path) => (
                          <li key={path}>
                            <Link href={pageHref(path)} className="text-[13px] text-orange hover:text-orange-light">
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
                            <Link href={pageHref(path)} className="text-[13px] text-orange hover:text-orange-light">
                              {path}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-2 text-[12px] text-muted-text tracking-body">
                    {ingestState.output.reviews} review item{ingestState.output.reviews === 1 ? "" : "s"} flagged —{" "}
                    <Link href="/wiki/inbox" className="text-orange hover:text-orange-light">
                      view inbox
                    </Link>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={ingestState.undoing || ingestState.undone}
                      className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1 disabled:opacity-50"
                    >
                      {ingestState.undone ? "Undone" : ingestState.undoing ? "Undoing…" : "Undo"}
                    </button>
                    {ingestState.undoError && <span className="text-[12px] text-red-700">{ingestState.undoError}</span>}
                  </div>
                </div>
              )}

              {ingestState.phase === "done" && ingestState.output.status === "draft" && (
                <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-light-surface">
                  <div className="text-[13px] text-espresso font-medium">
                    Generation needs review — nothing was written to the vault
                  </div>
                  <ul className="mt-2 list-disc list-inside text-[13px]/[14px] text-espresso space-y-0.5">
                    {ingestState.output.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
