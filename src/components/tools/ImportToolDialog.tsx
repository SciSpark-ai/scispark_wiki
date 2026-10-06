"use client"
import { useRef, useState, type ReactNode } from "react"
import { useModalFocus } from "@/components/ui/useModalFocus"
import { Button } from "@/components/ui/Button"
import { confirmToolImportRemote, discoverAgentSkillsRemote, inspectToolImportRemote, previewToolImportRemote } from "@/lib/extensions/client"
import { DiscoveryGrantDtoSchema, DiscoveryStageDtoSchema, type DiscoveredSkill, type DiscoveryRoot } from "@/lib/extensions/import-contract"
import type { z } from "zod"
import type { ToolRef } from "@/lib/extensions/contracts"
import type { ImportState } from "@/lib/extensions/ui-contract"
export const toolInputClass = "mt-1 w-full min-w-0 rounded-xl border border-border-warm bg-card-surface px-3 py-2 text-sm text-espresso focus-visible:outline-2 focus-visible:outline-accent-ink"
export function ToolDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref, true, onClose)
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/30 p-3" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-card border border-border-warm bg-page-bg p-5 text-espresso shadow-xl focus:outline-none sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3"><h2 className="font-heading text-2xl">{title}</h2><Button variant="quiet" onClick={onClose}>Close</Button></div>{children}
    </div>
  </div>
}

type Preview = z.infer<typeof DiscoveryStageDtoSchema>
export function ImportToolDialog({ initial, onClose, onChanged, onManage }: { initial: "choose" | "agents" | "opencite"; onClose: () => void; onChanged: () => Promise<void>; onManage: (tool: ToolRef) => void }) {
  const [mode, setMode] = useState<string>(initial), [path, setPath] = useState(""), [url, setUrl] = useState(""), [revision, setRevision] = useState("")
  const [agent, setAgent] = useState<DiscoveryRoot["agent"]>("codex"), [layout, setLayout] = useState<DiscoveryRoot["layout"]>("skills"), [consent, setConsent] = useState(false)
  const [grantId, setGrantId] = useState<string | null>(null), [candidates, setCandidates] = useState<DiscoveredSkill[] | null>(null), [preview, setPreview] = useState<Preview | null>(null), [state, setState] = useState<ImportState | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("")
  function showPreview(value: Preview) { setPreview(value); setSelected(value.tools.map(t => t.manifest.ref.skillId)); setReviewed(false) }
  async function run(work: () => Promise<void>) { setBusy(true); setError(""); try { await work() } catch (e) { setError(e instanceof Error ? e.message : "Could not inspect this tool. Check its source and try again.") } finally { setBusy(false) } }
  async function discover() {
    const grant = DiscoveryGrantDtoSchema.parse(await discoverAgentSkillsRemote({ action: "grant", operationId: crypto.randomUUID(), roots: [{ agent, layout, path }] }))
    setGrantId(grant.id)
    const result = await discoverAgentSkillsRemote({ action: "discover", operationId: crypto.randomUUID(), grantId: grant.id })
    if (!Array.isArray(result)) throw new Error("Invalid discovery response")
    setCandidates(result)
  }
  return <ToolDialog title={preview ? "Review import" : "Add tools"} onClose={onClose}>
    {error && <p role="alert" className="mb-4 rounded-xl border border-border-warm p-3 text-sm">{error}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-4">
    {!preview && <>
      {mode === "choose" && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setMode("github")}>GitHub</Button><Button variant="secondary" onClick={() => setMode("local")}>Local files or folder</Button><Button variant="secondary" onClick={() => setMode("agents")}>Installed agents</Button></div>}
      {mode === "github" && <><label className="block text-sm">GitHub repository<input className={toolInputClass} placeholder="https://github.com/owner/repository" value={url} onChange={e => setUrl(e.target.value)} /></label><label className="block text-sm">Branch or revision (optional)<input className={toolInputClass} value={revision} onChange={e => setRevision(e.target.value)} /></label><Button disabled={!url} onClick={() => void run(async () => showPreview(await previewToolImportRemote({ source: { kind: "github", url, ...(revision ? { ref: revision } : {}) } })))}>Preview import</Button></>}
      {mode === "local" && <><label className="block text-sm">Folder path<input className={toolInputClass} value={path} onChange={e => setPath(e.target.value)} placeholder="Absolute folder on this computer" /></label><p className="text-sm text-muted-text">Only this selected folder will be read by the local runtime.</p><Button disabled={!path.startsWith("/")} onClick={() => void run(async () => showPreview(await previewToolImportRemote({ source: { kind: "local-folder", path } })))}>Preview selected folder</Button><label className="block text-sm">Or upload a ZIP file<input className={toolInputClass} type="file" accept=".zip,application/zip" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { if (file.size > 50 * 1024 * 1024) throw new Error("ZIP exceeds 50 MiB."); showPreview(await previewToolImportRemote(file)) }) }} /></label><p className="text-xs text-muted-text">Up to 50 MiB compressed, 250 MiB expanded, 10,000 files; 25 MiB per file.</p></>}
      {mode === "opencite" && <><p className="text-sm">Review the bundled OpenCite adapter for Semantic Scholar search, public PDFs and BibTeX.</p><Button onClick={() => void run(async () => showPreview(await previewToolImportRemote({ catalogId: "opencite" })))}>Preview OpenCite</Button></>}
      {mode === "agents" && <>
        {!grantId && <><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Agent<select className={toolInputClass} value={agent} onChange={e => { setAgent(e.target.value as DiscoveryRoot["agent"]); setConsent(false) }}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="custom">Other collection</option></select></label><label className="text-sm">Folder layout<select className={toolInputClass} value={layout} onChange={e => { setLayout(e.target.value as DiscoveryRoot["layout"]); setConsent(false) }}>{["skills", "config", "plugin-cache", "package"].map(v => <option key={v}>{v}</option>)}</select></label></div><label className="block text-sm">Folder path<input className={toolInputClass} value={path} onChange={e => { setPath(e.target.value); setConsent(false) }} placeholder="Choose an absolute agent skills folder" /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" />Allow access to this folder for 30 minutes in this profile.</label><p className="text-xs text-muted-text">Discovery reads installed skills. It does not enable them or read agent credentials and sessions.</p><Button disabled={!consent || !path.startsWith("/")} onClick={() => void run(discover)}>Discover skills</Button></>}
        {grantId && <Button variant="secondary" onClick={() => void run(async () => { await discoverAgentSkillsRemote({ action: "revoke", operationId: crypto.randomUUID(), grantId }); setGrantId(null); setCandidates(null); setConsent(false) })}>Revoke access</Button>}
        {candidates?.length === 0 && <p className="text-sm">No skills found in this folder. Choose another folder.</p>}
        {candidates?.map(candidate => <div key={candidate.id} className="rounded-xl border border-border-warm p-4"><h3 className="font-heading text-lg">{candidate.name}</h3><p className="text-sm text-muted-text">{candidate.description}</p><p className="mt-2 text-xs">Discovered · {candidate.origins.map(o => o.agent).join(", ")}</p><Button variant="secondary" className="mt-3" onClick={() => void run(async () => showPreview(DiscoveryStageDtoSchema.parse(await discoverAgentSkillsRemote({ action: "stage", operationId: crypto.randomUUID(), grantId: grantId!, candidateId: candidate.id }))))}>Review skill</Button></div>)}
      </>}
    </>}
    {preview && <>
      {preview.warnings.map(warning => <p key={warning} className="text-sm">{warning}</p>)}
      {preview.tools.map(tool => { const saved = state?.tools.find(t => t.tool.skillId === tool.manifest.ref.skillId); return <article key={tool.manifest.ref.skillId} className="rounded-xl border border-border-warm p-4">
        <label className="flex items-start gap-2 font-heading text-xl"><input className="mt-1.5" type="checkbox" disabled={!!state} checked={selected.includes(tool.manifest.ref.skillId)} onChange={e => setSelected(e.target.checked ? [...selected, tool.manifest.ref.skillId] : selected.filter(s => s !== tool.manifest.ref.skillId))} />{tool.manifest.name}</label>
        <p className="mt-1 text-sm text-muted-text">{tool.manifest.description}</p>
        <p className="mt-3 text-sm">Access: {tool.proposal.capabilities.join(", ") || "Provided research context"}. Connections: {tool.proposal.connections.join(", ") || "None"}.</p>
        <p className="mt-1 break-words text-sm">Dependencies: {tool.proposal.dependencies.map(d => `${d.packageId} / ${d.skillId}`).join(", ") || "None"}.</p>
        <p className="mt-2 text-sm">{{ ready: "Ready", "needs-setup": "Needs setup", "needs-review": "Needs review", unsupported: "Unsupported" }[saved?.readiness.status ?? tool.compatibility.status]}: {(saved?.readiness.reasons ?? tool.compatibility.reasons).join(" ")}</p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer">Resources and setup plan</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-card-surface p-3 text-xs">{JSON.stringify({ resources: tool.proposal.resources, setup: tool.proposal.setup, engines: tool.proposal.engines, hostUnsupported: tool.hostUnsupported }, null, 2)}</pre></details>
        {saved?.blockedTool && <p className="mt-3 text-sm font-medium">
          {saved.blockedTool.tool.digest === tool.manifest.ref.digest ? "Tool" : "Supporting tool"}: {saved.blockedTool.name}
        </p>}
        {saved?.setup && <p role="status" className="mt-2 text-sm">{saved.setup.reason}</p>}
        {state && selected.includes(tool.manifest.ref.skillId) && saved?.readiness.status !== "ready" && <div className="mt-3 space-y-2">
          <p className="text-sm text-muted-text">Continue in Manage to connect services or review environment setup.</p>
          <Button variant="secondary" onClick={() => onManage(tool.manifest.ref)}>Manage setup</Button>
        </div>}
      </article> })}
      {!state ? <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} className="mt-1" />I reviewed these tools, their access and setup requirements.</label><Button disabled={!reviewed || !selected.length} onClick={() => void run(async () => { const result = await confirmToolImportRemote(preview.id, { action: "confirm", selected: preview.tools.filter(t => selected.includes(t.manifest.ref.skillId)).map(t => t.manifest.ref), proposals: preview.tools.map(t => t.proposal) }); setState(result); setPreview(result.preview); await onChanged() })}>Confirm import</Button></> : <><p role="status" className="text-sm">Import saved.</p><Button variant="secondary" onClick={() => void run(async () => setState(await inspectToolImportRemote(preview.id)))}>Refresh setup status</Button></>}
    </>}
    </fieldset>{busy && <p role="status" className="mt-4 text-sm text-muted-text">Working… You can close this view and reopen saved setup.</p>}
  </ToolDialog>
}
