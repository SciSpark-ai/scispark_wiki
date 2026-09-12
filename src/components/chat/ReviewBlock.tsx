"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { readReview, changeReview } from "@/lib/review/client"
import type { ReviewAction, ReviewRun } from "@/lib/review/contracts"
import { Button } from "@/components/ui/Button"

export function useReview(id: string) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readReview>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const status = useRef<string | null>(null)
  const refresh = useCallback(async () => {
    try { const next = await readReview(id); if (alive.current) { status.current = next.run.status; setSnapshot(next) } }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not load review") }
  }, [id])
  useEffect(() => {
    alive.current = true; void refresh()
    const timer = window.setInterval(() => { if (!status.current || ["queued", "running"].includes(status.current)) void refresh() }, 2500)
    const changed = () => { void refresh() }
    window.addEventListener("review-changed", changed)
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener("review-changed", changed) }
  }, [refresh])
  const act = async (action: ReviewAction) => {
    setBusy(true); setError(null)
    try { const result = await changeReview(id, action); await refresh(); window.dispatchEvent(new Event("review-changed")); return result }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return null }
    finally { if (alive.current) setBusy(false) }
  }
  return { snapshot, error, busy, act }
}
const inputClass = "mt-1 w-full rounded-xl border border-border-warm bg-page-bg px-3 py-2 text-sm text-espresso focus:outline-orange"
export function ReviewBlock({ id }: { id: string }) {
  const { snapshot, error, busy, act } = useReview(id)
  const run = snapshot?.run
  const [editing, setEditing] = useState(false)
  if (!run) return <p className="mt-3 text-sm text-muted-text" role="status">{error ?? "Loading review…"}</p>
  const coverageLimited = run.versions.at(-1)?.answerCoverage?.status === "limited"
  const sourceChecksPassed = run.versions.at(-1)?.verification === "checked-draft"
  const active = run.status === "running" || run.status === "queued"
  const open = () => window.dispatchEvent(new CustomEvent("open-review-report", { detail: id }))
  return <section className="mt-4 border-t border-border-warm pt-4" aria-label="Literature review">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-heading text-xl text-espresso">{run.status === "awaiting-approval" ? "Your review brief" : run.stage}</h3>
      <span className="text-xs text-muted-text">{run.brief.model.engine ? `${snapshot.spending.engineCalls ?? 0} engine calls · plan limits` : `$${snapshot.spending.spentUsd.toFixed(3)} of $${run.brief.allowanceUsd.toFixed(2)}`}</span>
    </div>
    {editing ? <BriefEditor key={run.revision} run={run} busy={busy} onCancel={() => setEditing(false)} onSave={async (action) => { if (await act(action)) setEditing(false) }} /> : <>
      {run.status === "awaiting-approval" && <>
        <p className="mt-2 text-sm leading-relaxed text-espresso">{run.brief.question}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-text">{run.brief.scope}</p>
        <p className="mt-3 text-xs leading-relaxed text-muted-text">{run.brief.sources.join(", ")} · {run.brief.model.engine ?? run.brief.model.provider} · {run.brief.model.model}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-text">{run.brief.model.engine ? "Uses your engine subscription. Up to 120 calls per review, bounded by the per-request timeout in Settings. Token caps are approximate; source-service charges are separate." : "The allowance is an estimated AI spending limit, not a fixed review price. Source-service charges are separate."}</p>
        <details className="mt-3 text-sm text-espresso"><summary className="cursor-pointer">Personal context {run.brief.usePersonalContext ? `(${run.brief.context.length} selected items)` : "off"}</summary>
          <p className="mt-2 text-xs text-muted-text">Selected context reaches your configured AI provider, never the paper indexes. Preferences do not exclude contradictory evidence.</p>
          {run.brief.context.map((c) => <div key={c.id} className="mt-2 border-l border-border-warm pl-3"><p className="font-medium">{c.label}</p><p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-text">{c.text}</p></div>)}
        </details>
        {!run.brief.model.engine && !run.brief.model.rates && <p role="status" className="mt-3 text-sm text-espresso">Add this model&apos;s token prices in Edit brief to enforce your allowance.</p>}
        {run.approvedRevision === null && <PdfAttachment run={run} />}
      </>}
      {active && <p role="status" className="mt-3 text-sm text-muted-text">{run.evidence.length} papers available so far. You can leave this page while the local server continues.</p>}
      {run.status === "partial" && <p className="mt-3 text-sm text-muted-text">{coverageLimited && sourceChecksPassed ? "Source checks passed, but this reading set cannot fully answer your question. Start a new review with additional sources or a revised scope. Rechecking the same claims will not fill these evidence gaps." : "Some claims still need review. Retry source checks using the saved research and remaining allowance. The current report stays in History; another attempt may still need review."}</p>}
      {run.error && <p role="alert" className="mt-3 text-sm text-espresso">{run.error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {run.status === "awaiting-approval" && <Button disabled={busy || (!run.brief.model.engine && !run.brief.model.rates)} onClick={() => void act({ action: "approve", revision: run.revision })}>Start review</Button>}
        {["awaiting-approval", "paused", "interrupted", "failed"].includes(run.status) && <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit brief</Button>}
        {["paused", "interrupted", "failed", "partial"].includes(run.status) && !(run.status === "partial" && coverageLimited && sourceChecksPassed) && <Button disabled={busy || snapshot.spending.uncertain} onClick={() => void act({ action: "resume", revision: run.revision, acknowledgeUncertainCharge: false })}>{run.status === "partial" ? "Retry source checks" : "Resume review"}</Button>}
        {(active || run.status === "paused") && <Button variant="quiet" disabled={busy} onClick={() => void act({ action: "cancel" })}>Cancel review</Button>}
        {(run.evidence.length > 0 || run.versions.length > 0) && <Button variant="secondary" onClick={open}>{run.versions.length ? "Open report" : "Inspect sources"}</Button>}
      </div>
      {snapshot.spending.uncertain && !active && <details className="mt-3 text-sm text-espresso"><summary>Resolve uncertain usage</summary><p className="my-2">{run.brief.model.engine ? "A prior engine call may have consumed plan usage without returning a result. Retrying uses additional plan capacity." : `A prior call may have cost up to $${snapshot.spending.heldUsd.toFixed(3)} without returning a usable result. Retrying can incur another charge.`}</p><Button disabled={busy} onClick={() => void act({ action: "resume", revision: run.revision, acknowledgeUncertainCharge: true })}>Acknowledge and resume</Button></details>}
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-espresso">{error}</p>}
  </section>
}

function PdfAttachment({ run }: { run: ReviewRun }) {
  const [title, setTitle] = useState("")
  const [doi, setDoi] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return <details className="mt-3 text-sm text-espresso"><summary className="cursor-pointer">Add a paper PDF (optional){run.uploads.length ? ` · ${run.uploads.length} attached` : ""}</summary>
    <p className="mt-2 text-xs leading-relaxed text-muted-text">Use a PDF you are allowed to share with your configured AI provider. Up to 5 MB; readable text only. Extraction is capped at 50 pages and 45,000 characters.</p>
    {run.uploads.map((u) => <p key={u.hash} className="mt-2 text-xs">Attached: {u.name}</p>)}
    <form className="mt-3 space-y-2" onSubmit={async (e) => {
      e.preventDefault(); if (!file) return
      setBusy(true); setError("")
      const form = new FormData(); form.set("file", file); form.set("title", title); form.set("doi", doi); form.set("revision", String(run.revision)); form.set("permission", "yes")
      try {
        const response = await fetch(`/api/reviews/${run.id}/pdf`, { method: "POST", body: form })
        const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not attach PDF")
        setTitle(""); setDoi(""); setFile(null); window.dispatchEvent(new Event("review-changed"))
      } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
    }}>
      <label className="block">Paper title<input required minLength={10} value={title} className={inputClass} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="block">DOI (optional)<input value={doi} className={inputClass} onChange={(e) => setDoi(e.target.value)} /></label>
      <label className="block">PDF file<input type="file" accept="application/pdf,.pdf" className="mt-1 block w-full text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" required />I may use this PDF and send its extracted text to my AI provider.</label>
      <Button type="submit" disabled={busy || !file || run.uploads.length >= 4}>{busy ? "Reading PDF…" : "Attach PDF"}</Button>
      {error && <p role="alert" className="text-xs">{error}</p>}
    </form>
  </details>
}

function BriefEditor({ run, busy, onSave, onCancel }: { run: ReviewRun; busy: boolean; onSave: (action: ReviewAction) => Promise<void>; onCancel: () => void }) {
  const [question, setQuestion] = useState(run.brief.question)
  const [scope, setScope] = useState(run.brief.scope)
  const [allowance, setAllowance] = useState(String(run.brief.allowanceUsd))
  const [personal, setPersonal] = useState(run.brief.usePersonalContext)
  const [rates, setRates] = useState([run.brief.model.rates?.inputPerMillion, run.brief.model.rates?.outputPerMillion, run.brief.model.rates?.cachedInputPerMillion].map((n) => n === undefined ? "" : String(n)))
  return <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void onSave({ action: "amend", revision: run.revision, question, scope, allowanceUsd: Number(allowance), usePersonalContext: personal,
    rates: rates[0] && rates[1] ? { inputPerMillion: Number(rates[0]), outputPerMillion: Number(rates[1]), ...(rates[2] ? { cachedInputPerMillion: Number(rates[2]) } : {}) } : null }) }}>
    <label className="block text-sm text-espresso">Research question<textarea className={inputClass} rows={2} value={question} disabled={run.approvedRevision !== null} onChange={(e) => setQuestion(e.target.value)} /></label>
    <label className="block text-sm text-espresso">Scope and exclusions<textarea className={inputClass} rows={3} value={scope} disabled={run.approvedRevision !== null} onChange={(e) => setScope(e.target.value)} /></label>
    {!run.brief.model.engine && <>
    <label className="block text-sm text-espresso">AI allowance (USD)<input type="number" min="0.01" max="100" step="0.01" required className={inputClass} value={allowance} onChange={(e) => setAllowance(e.target.value)} /></label>
    <fieldset><legend className="text-sm text-espresso">Model prices (USD per million tokens)</legend><div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">{["Input", "Output", "Cache reads (optional)"].map((label, i) => <label key={label} className="text-xs text-muted-text">{label}<input className={inputClass} type="number" min="0" step="any" required={i < 2} value={rates[i]} onChange={(e) => setRates(rates.map((r, j) => i === j ? e.target.value : r))} /></label>)}</div></fieldset>
    </>}
    <label className="flex gap-2 text-sm text-espresso"><input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />Use the selected profile and memory context</label>
    <div className="flex gap-3"><Button type="submit" disabled={busy}>Update brief</Button><Button variant="quiet" onClick={onCancel}>Cancel edit</Button></div>
  </form>
}
