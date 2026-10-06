"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { z } from "zod"
import { useLocalProfile } from "@/components/layout/ProfileGate"
import { getToolArtifactRemote, saveToolRunRemote } from "@/lib/workflows/client"
import type { Artifact, ToolRunDto } from "@/lib/workflows/contracts"
import { ChatMarkdown } from "@/components/chat/ChatMarkdown"
import { PaperResultsBlock } from "@/components/chat/PaperResultsBlock"
import { OpenCiteResultSchema } from "@/lib/extensions/import-contract"
import { Button } from "@/components/ui/Button"
const publicUrl = z.url().refine(value => /^https?:\/\//i.test(value), "Expected a public HTTP URL")
const source = z.enum(["arxiv", "openalex", "s2", "pubmed"])
const Paper = z.object({ ids: z.object({ doi: z.string().optional(), arxiv: z.string().optional(), openalex: z.string().optional(), s2: z.string().optional(), pmid: z.string().optional() }), title: z.string(), abstract: z.string().optional(), authors: z.array(z.object({ name: z.string() })), year: z.number().optional(), venue: z.string().optional(), fields: z.array(z.string()), source, htmlUrl: publicUrl.optional(), pdfUrl: publicUrl.optional(), oaUrl: publicUrl.optional() })
const Papers = z.object({ query: z.string(), plan: z.object({ interpretation: z.string(), sort: z.enum(["relevance", "date"]), fromDate: z.string().nullable(), queries: z.array(z.object({ source, query: z.string(), rationale: z.string() })) }), items: z.array(z.object({ paper: Paper, score: z.number(), whyMatch: z.string(), foundBy: z.array(z.object({ source, rationale: z.string() })) })), stats: z.object({ retrieved: z.number(), deduplicated: z.number() }), costUsd: z.number().nullable(), warnings: z.array(z.string()) })
const fullTextLabels = { "not-requested": "Full text not requested", "request-limit": "Full-text request limit reached", "no-location": "No PDF location reported", "policy-denied": "PDF access was refused", "size-limit": "PDF exceeds the size limit", "retrieval-failed": "PDF retrieval failed", "invalid-pdf": "Source did not return a valid PDF", "conversion-failed": "Text conversion failed", available: "Full text", unknown: "Full-text availability not confirmed" }
function OpenCitePapers({ papers }: { papers: z.infer<typeof OpenCiteResultSchema>["papers"] }) {
  return <div className="mt-4 space-y-4">{papers.map((paper,index) => <article key={index} className="rounded-xl border border-border-warm p-4">
    <h4 className="text-sm font-medium text-espresso">{paper.url ? <a href={paper.url} target="_blank" rel="noreferrer" className="text-accent-ink underline">{paper.title}</a> : paper.title}</h4>
    <p className="mt-1 text-xs text-muted-text">{paper.authors.join(", ")}{paper.year ? ` · ${paper.year}` : ""}</p>
    <p className="mt-2 text-sm text-muted-text">{paper.access === "abstract" ? "Abstract only" : paper.fullTextStatus === "conversion-failed" ? "PDF available" : "Full text"}{paper.fullTextStatus && !["available"].includes(paper.fullTextStatus) ? ` · ${fullTextLabels[paper.fullTextStatus]}` : ""}</p>
    {paper.abstract && <p className="mt-2 whitespace-pre-wrap text-sm text-espresso">{paper.abstract}</p>}
    {paper.doi && <a className="mt-2 block break-words text-xs text-accent-ink underline" href={`https://doi.org/${encodeURIComponent(paper.doi)}`} target="_blank" rel="noreferrer">DOI: {paper.doi}</a>}
    <details className="mt-2 text-xs text-muted-text"><summary>Paper sources</summary><ul className="mt-2 space-y-1">{paper.sourceRefs.map(ref => <li className="break-words" key={ref}>{citationHref(ref) ? <a href={citationHref(ref)} target="_blank" rel="noreferrer" className="text-accent-ink underline">{ref}</a> : ref}</li>)}</ul></details>
  </article>)}</div>
}
function citationHref(ref: string) {
  if (/^https?:\/\//i.test(ref)) { try { return new URL(ref).href } catch { return undefined } }
  if (ref.startsWith("wiki/") && ref.endsWith(".md") && !ref.includes("..")) return `/wiki/${ref.slice(5, -3).split("/").map(encodeURIComponent).join("/")}`
  return undefined
}
function ArtifactCard({ runId, artifact }: { runId: string; artifact: Artifact }) {
  const [open, setOpen] = useState(false), [text, setText] = useState<string | null>(null), [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => { const controller = new AbortController(); abort.current = controller; return () => controller.abort() }, [])
  async function read(download: boolean) {
    try {
      const response = await getToolArtifactRemote(runId, artifact.id, fetch, abort.current?.signal)
      if (download) {
        const blob = await response.blob()
        if (abort.current?.signal.aborted) return
        const url = URL.createObjectURL(blob), a = document.createElement("a")
        a.href = url; a.download = `artifact-${artifact.id}.${artifact.kind === "markdown" ? "md" : artifact.kind === "bibtex" ? "bib" : artifact.kind === "papers" ? "json" : "bin"}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else {
        const value = await response.text()
        if (!abort.current?.signal.aborted) { setText(value); setOpen(true) }
      }
    } catch (err) { if (!abort.current?.signal.aborted) setError(err instanceof Error ? err.message : "Could not read artifact.") }
  }
  const parsed = text && artifact.kind === "papers" ? (() => { try { const value = JSON.parse(text); const direct = Papers.safeParse(value); if (direct.success) return direct.data; for (const block of value?.message?.blocks ?? []) { if (block.type === "paper-results") return Papers.parse(block.result) } } catch {} return null })() : null
  const openCite = text && artifact.kind === "papers" ? (() => { try { return OpenCiteResultSchema.shape.papers.parse(JSON.parse(text)) } catch { return null } })() : null
  return <article className="min-w-0 rounded-card border border-border-warm bg-light-surface p-4"><h3 className="break-words text-sm font-medium text-espresso">{artifact.title}</h3><div className="mt-2 flex flex-wrap gap-2">{artifact.kind !== "file" && <Button variant="secondary" size="sm" onClick={() => open ? setOpen(false) : text !== null ? setOpen(true) : void read(false)}>{open ? "Hide" : "Preview"}</Button>}<Button variant="quiet" size="sm" onClick={() => void read(true)}>Download {artifact.kind === "bibtex" ? "BibTeX" : artifact.kind}</Button></div>
    {open && text !== null && (artifact.kind === "papers" ? parsed ? <PaperResultsBlock result={parsed} /> : openCite ? <OpenCitePapers papers={openCite} /> : <p className="mt-3 text-sm text-muted-text">This paper export is available as a download.</p> : artifact.kind === "bibtex" ? <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all text-xs text-espresso">{text}</pre> : <ChatMarkdown text={text} />)}
    {artifact.sourceRefs.length > 0 && <details className="mt-3 text-sm text-muted-text"><summary className="cursor-pointer">Sources ({artifact.sourceRefs.length})</summary><ul className="mt-2 space-y-2">{artifact.sourceRefs.map(ref => { const href = citationHref(ref); return <li key={ref} className="break-words">{href ? <a href={href} className="text-accent-ink underline" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{ref}</a> : ref}</li> })}</ul></details>}
    {error && <p role="alert" className="mt-2 text-sm text-espresso">{error}</p>}
  </article>
}
type Saves = NonNullable<ToolRunDto["observation"]>["saves"]
export function ToolArtifacts({ runId, artifacts, saveableArtifactIds = [], nextSaveArtifactIds, saves = [], onSaved }: { runId: string; artifacts: Artifact[]; saveableArtifactIds?: string[]; nextSaveArtifactIds?: string[]; saves?: Saves; onSaved?: () => Promise<void> }) {
  const profile = useLocalProfile()
  return <Artifacts key={`${profile?.id ?? "local"}:${runId}`} runId={runId} artifacts={artifacts} saveableArtifactIds={saveableArtifactIds} nextSaveArtifactIds={nextSaveArtifactIds} saves={saves} onSaved={onSaved} />
}
function Artifacts({ runId, artifacts, saveableArtifactIds, nextSaveArtifactIds, saves, onSaved }: { runId: string; artifacts: Artifact[]; saveableArtifactIds: string[]; nextSaveArtifactIds?: string[]; saves: Saves; onSaved?: () => Promise<void> }) {
  const [selections, setSelections] = useState<Record<string, { busy: boolean; saved: boolean; error: string | null }>>({})
  const alive = useRef(true), sending = useRef(new Set<string>()), operations = useRef(new Map<string, string>())
  const savedIds = new Set(saves.filter(save => save.state === "saved").flatMap(save => save.artifactIds))
  for (const [key, state] of Object.entries(selections)) if (state.saved) for (const id of JSON.parse(key) as string[]) savedIds.add(id)
  const localPending = Object.entries(selections).find(([, state]) => state.busy)
  const ids = (localPending ? JSON.parse(localPending[0]) as string[] : nextSaveArtifactIds ?? saveableArtifactIds.filter(id => !savedIds.has(id))).slice().sort(), selection = JSON.stringify(ids)
  const { busy = false, error = null } = selections[selection] ?? {}
  const pendingSave = saves.some(save => save.state === "pending" && JSON.stringify([...save.artifactIds].sort()) === selection)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function save() {
    if (sending.current.has(selection)) return
    sending.current.add(selection)
    const update = (value: { busy: boolean; saved: boolean; error: string | null }) => { if (alive.current) setSelections(previous => ({ ...previous, [selection]: value })) }
    update({ busy: true, saved: false, error: null })
    const operation = operations.current.get(selection) ?? crypto.randomUUID(); operations.current.set(selection, operation)
    try { await saveToolRunRemote(runId, ids, operation); update({ busy: false, saved: true, error: null }); if (alive.current) await onSaved?.() }
    catch (err) { update({ busy: false, saved: false, error: err instanceof Error ? err.message : "Could not save to wiki." }) }
    finally { sending.current.delete(selection) }
  }
  if (!artifacts.length) return null
  const hasSaved = saveableArtifactIds.length > 0 && saveableArtifactIds.every(id => savedIds.has(id))
  return <section aria-label="Saved artifacts" className="space-y-3"><h2 className="font-heading text-xl text-espresso">Results</h2>{artifacts.map(artifact => <ArtifactCard key={artifact.id} runId={runId} artifact={artifact} />)}{ids.length > 0 && (!hasSaved || pendingSave) && <Button disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : pendingSave ? "Check pending save" : savedIds.size ? "Add new results to wiki" : "Add to wiki"}</Button>}{hasSaved && <p role="status" className="text-sm text-muted-text">Added to wiki. <Link className="text-accent-ink underline" href="/history?tab=changes">Review or undo in History</Link>.</p>}{error && <p role="alert" className="text-sm text-espresso">{error}</p>}</section>
}
