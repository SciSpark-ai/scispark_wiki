"use client"
import { useCallback, useEffect, useState } from "react"
import { PageHeader } from "@/components/ui/PageHeader"
import { Button } from "@/components/ui/Button"
import { toolKey } from "@/lib/extensions/contracts"
import type { LibraryTool, ToolLibrary } from "@/lib/extensions/ui-contract"
import { listToolsRemote, checkToolMetadataRemote, updateToolVersionRemote, updateToolsProfileRemote } from "@/lib/extensions/client"
import { ToolCard } from "./ToolCard"
import { ImportToolDialog } from "./ImportToolDialog"
import { ToolSettings } from "./ToolSettings"
export function ToolsLibrary() {
  const [library, setLibrary] = useState<ToolLibrary | null>(null), [view, setView] = useState("Installed"), [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const [add, setAdd] = useState<"choose" | "agents" | "opencite" | null>(null), [managed, setManaged] = useState<LibraryTool | null>(null)
  const closeImport = useCallback(() => setAdd(null), [])
  const closeManagement = useCallback(() => setManaged(null), [])
  const refresh = useCallback(async () => { try { const next = await listToolsRemote(); setLibrary(next); setManaged(current => current ? next.tools.find(t => toolKey(t.ref) === toolKey(current.ref)) ?? null : null) } catch { setError("Could not load Tools. Reopen your profile or try again.") } }, [])
  useEffect(() => { let alive = true; void listToolsRemote().then(value => { if (alive) setLibrary(value) }, () => { if (alive) setError("Could not load Tools. Reopen your profile or try again.") }); void checkToolMetadataRemote().catch(() => {}); return () => { alive = false } }, [])
  async function act(work: () => Promise<unknown>) { setBusy(true); setError(""); try { await work(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : "Could not update Tools.") } finally { setBusy(false) } }
  const tools = library?.tools.filter(t => view === "Installed" ? t.installed : !t.installed) ?? []
  return <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
    <PageHeader title="Tools" actions={<Button onClick={() => setAdd("choose")}>Add tools</Button>} />
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Tools view">{["Installed", "Catalog"].map(name => <Button key={name} variant={view === name ? "primary" : "secondary"} aria-pressed={view === name} onClick={() => setView(name)}>{name}</Button>)}</div>
    {error && <div role="alert" className="mb-4 rounded-xl border border-border-warm p-4 text-sm text-espresso">{error} <Button variant="secondary" onClick={() => void refresh()}>Try again</Button></div>}
    {!library && !error && <p role="status" className="text-sm text-muted-text">Loading tools…</p>}
    {library && view === "Installed" && !tools.length && <div className="mb-5 rounded-card border border-border-warm bg-light-surface p-6"><h2 className="font-heading text-xl text-espresso">No tools installed</h2><p className="mt-1 text-sm text-muted-text">Add a research tool from the catalog or import your own.</p><Button className="mt-4" variant="secondary" onClick={() => setView("Catalog")}>Browse catalog</Button></div>}
    <div className="grid gap-4 md:grid-cols-2">{tools.map(tool => <ToolCard key={toolKey(tool.ref)} tool={tool} busy={busy} onAdd={() => void act(() => updateToolVersionRemote(toolKey(tool.ref), { action: "enable", operationId: crypto.randomUUID(), enabled: true }))} onPin={() => void act(() => updateToolsProfileRemote({ action: "pin", operationId: crypto.randomUUID(), key: toolKey(tool.ref), pinned: !tool.pinned }))} onManage={() => setManaged(tool)} />)}
      {view === "Catalog" && library?.catalog.map(entry => <article key={entry.id} className="rounded-card border border-border-warm bg-light-surface p-5"><h2 className="font-heading text-xl text-espresso">{entry.name}</h2><p className="mt-1 text-sm text-muted-text">{entry.description}</p><Button className="mt-4" onClick={() => setAdd("opencite")}>Review tool</Button></article>)}
    </div>
    {library && !library.discoveryDismissed && <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border-warm p-4"><p className="grow text-sm text-espresso">Bring skills from an installed agent.</p><Button variant="secondary" onClick={() => setAdd("agents")}>Find installed skills</Button><Button variant="quiet" onClick={() => void act(() => updateToolsProfileRemote({ action: "dismiss-discovery", operationId: crypto.randomUUID(), dismissed: true }))}>Dismiss</Button></div>}
    {add && <ImportToolDialog initial={add} onClose={closeImport} onChanged={refresh} onManage={ref => {
      const tool = library?.tools.find(t => toolKey(t.ref) === toolKey(ref) && t.ref.digest === ref.digest && t.ref.version === ref.version)
      if (tool) { setAdd(null); setManaged(tool) }
      else setError("This imported version is no longer installed. Reopen Tools to manage the current version.")
    }} />}
    {managed && <ToolSettings tool={managed} onClose={closeManagement} onChanged={refresh} />}
  </div>
}
