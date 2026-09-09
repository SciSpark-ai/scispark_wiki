"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useReview } from "./ReviewBlock"
import { Button } from "@/components/ui/Button"
import { renderMarkdown } from "@/components/wiki/markdown-preview"
import { coverageDisplayMarkdown } from "@/lib/review/coverage"

export function ReviewReport({ id, initialVersion, onClose }: { id: string; initialVersion?: string; onClose: () => void }) {
  const { snapshot, error, busy, act } = useReview(id)
  const [selected, setSelected] = useState(initialVersion ?? "")
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  const [parent, setParent] = useState("")
  const [instruction, setInstruction] = useState("")
  const [notice, setNotice] = useState("")
  const run = snapshot?.run
  const version = run?.versions.find((v) => v.id === selected) ?? run?.versions.at(-1)
  const evidence = version?.evidence ?? run?.evidence ?? []
  // Keep unsaved edits through page switches; parent ID catches stale AI/human races.
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (!active) return; try {
    const draft = JSON.parse(sessionStorage.getItem(`review-edit:${id}`) ?? "null")
    if (typeof draft?.text === "string" && typeof draft?.parent === "string") { setText(draft.text); setParent(draft.parent); setEditing(true) }
  } catch {} }); return () => { active = false } }, [id])
  const beginEdit = () => { if (version) { setText(coverageDisplayMarkdown(version.markdown)); setParent(version.id); setEditing(true) } }
  return <aside className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-l border-border-warm bg-light-surface px-4 py-4 sm:px-6" aria-label="Review report">
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border-warm pb-3"><div><h2 className="font-heading text-2xl text-espresso">Literature review</h2><p className="mt-1 text-xs text-muted-text">Automatically retained in conversation History</p></div><button onClick={onClose} aria-label="Close report" className="p-2 text-muted-text hover:text-espresso"><X size={18} /></button></header>
    {error && <p role="alert" className="my-2 text-sm text-espresso">{error}</p>}
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4" aria-label="Report content" onClick={(event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="#review-source-"]') : null
      const sourceId = link?.getAttribute("href")?.slice(1)
      if (!sourceId || !/^review-source-P\d+$/.test(sourceId)) return
      const source = event.currentTarget.querySelector<HTMLDetailsElement>(`details[id="${sourceId}"]`)
      if (source) { event.preventDefault(); source.open = true; source.scrollIntoView({ block: "start", behavior: "smooth" }) }
    }}>
      {!run ? <p className="text-muted-text">Loading review…</p> : <>
        {version ? <>
          <div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-xs text-muted-text">Version <select aria-label="Report version" value={version.id} onChange={(e) => { setSelected(e.target.value); setEditing(false) }} className="ml-1 rounded-lg border border-border-warm bg-page-bg p-2 text-espresso">{run.versions.map((v, i) => <option key={v.id} value={v.id}>{i + 1} · {v.author}</option>)}</select></label><span className="text-xs text-muted-text">{version.verification === "checked-draft" ? "Automated source checks passed" : version.verification === "edited" ? "Edited claims need source checks" : "Some claims need source checks"}</span></div>
          <p role="status" className="mb-4 text-sm text-muted-text">{version.answerCoverage?.status === "addressed" ? "Answer coverage: requested aspects addressed (automated assessment)." : version.answerCoverage?.status === "limited" ? "Answer coverage: limited. Essential parts of your question remain unresolved." : "Answer coverage: not assessed for this version."}</p>
          {editing ? <><textarea aria-label="Edit review report" className="min-h-[55dvh] w-full rounded-xl border border-border-warm bg-page-bg p-4 text-sm leading-relaxed text-espresso" value={text} onChange={(e) => { setText(e.target.value); sessionStorage.setItem(`review-edit:${id}`, JSON.stringify({ text: e.target.value, parent })) }} /><div className="mt-3 flex gap-3"><Button disabled={busy} onClick={async () => { const result = await act({ action: "edit", parent, markdown: text }); if (result) { setEditing(false); setSelected(""); sessionStorage.removeItem(`review-edit:${id}`) } }}>Save new version</Button><Button variant="quiet" onClick={() => { setEditing(false); sessionStorage.removeItem(`review-edit:${id}`) }}>Discard edit</Button></div></> : <article className="break-words">{renderMarkdown(coverageDisplayMarkdown(version.markdown).replace(/\[(P\d+)\](?!\()/g, "[$1](#review-source-$1)"))}</article>}
          {version.personalRelevance && <section className="my-5 rounded-xl border border-border-warm bg-page-bg p-4"><h3 className="font-heading text-xl text-espresso">Connections to your research</h3><p className="my-2 text-xs leading-relaxed text-muted-text">Personal interpretation—not source-checked findings. Kept separate from the scientific report and its exports.</p>{renderMarkdown(version.personalRelevance)}</section>}
          {!editing && <div className="my-5 flex flex-wrap gap-3 border-y border-border-warm py-3 text-sm"><Button variant="secondary" onClick={beginEdit}>Edit report</Button><a className="self-center text-accent-ink" href={`/api/reviews/${id}/export?version=${version.id}&format=markdown`}>Markdown</a><a className="self-center text-accent-ink" href={`/api/reviews/${id}/export?version=${version.id}&format=bibtex`}>BibTeX</a><Button variant="quiet" disabled={busy} onClick={async () => { if (await act({ action: "knowledge-base", versionId: version.id })) setNotice("Added to your knowledge base. Undo is available in History → Changes; this report stays here.") }}>Add to knowledge base</Button></div>}
          <form className="my-4" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "revise", parent: version.id, instruction })) { setInstruction(""); setSelected("") } }}><label className="block text-sm text-espresso">Revise this draft<textarea aria-label="Revision request" className="mt-2 w-full rounded-xl border border-border-warm bg-page-bg p-3 text-sm text-espresso" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="For example: organize the findings by method." /></label><p className="mt-1 text-xs text-muted-text">Uses the remaining review allowance. New research needs a new approved brief.</p><Button className="mt-2" type="submit" disabled={busy || !instruction.trim()}>Revise wording</Button></form>
        </> : <><p className="text-sm leading-relaxed text-muted-text">{run.stage}. Sources collected so far remain available even if this review pauses.</p>{run.draft && <details className="mt-4"><summary className="cursor-pointer text-sm text-espresso">Unverified working draft</summary><article className="mt-3 break-words">{renderMarkdown(run.draft.markdown)}</article></details>}</>}
        {notice && <p role="status" className="my-3 text-sm text-espresso">{notice}</p>}
        <section className="mt-6"><h3 className="font-heading text-xl text-espresso">Sources read</h3><p className="mt-1 text-xs text-muted-text">Inspect the exact text available to the review. Missing full text limits what can be concluded.</p>
          {evidence.map((e) => <details id={`review-source-${e.id}`} key={e.id} className="scroll-mt-4 border-b border-border-warm py-3"><summary className="cursor-pointer text-sm leading-relaxed text-espresso">[{e.id}] {e.title}<span className="ml-2 text-xs text-muted-text">{e.access}</span></summary><p className="mt-2 text-xs text-muted-text">{e.paper.authors.map((a) => a.name).join(", ")}{e.paper.year ? ` (${e.paper.year})` : ""}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-espresso">{e.text}</p>{e.notes.map((n) => <p key={n} className="mt-2 text-xs text-muted-text">{n}</p>)}</details>)}
        </section>
      </>}
    </div>
  </aside>
}
