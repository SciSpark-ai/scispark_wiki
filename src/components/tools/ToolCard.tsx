"use client"
import Link from "next/link"
import { Button } from "@/components/ui/Button"
import type { LibraryTool } from "@/lib/extensions/ui-contract"
import { toolHref } from "@/lib/extensions/client"
export function ToolCard({ tool, busy, onAdd, onPin, onManage }: { tool: LibraryTool; busy: boolean; onAdd: () => void; onPin: () => void; onManage: () => void }) {
  return <article className="min-w-0 rounded-card border border-border-warm bg-light-surface p-5">
    <h2 className="break-words font-heading text-xl text-espresso">{tool.name}</h2>
    <p className="mt-1 text-sm leading-relaxed text-muted-text">{tool.description}</p>
    {tool.installed && <p className="mt-3 text-xs text-espresso">{tool.enabled ? "Enabled" : "Disabled"} · {tool.readiness.status === "ready" ? "Ready" : tool.readiness.status === "unsupported" ? "Unavailable on this computer" : "Setup needed"}</p>}
    {tool.installed && tool.readiness.reasons.map(reason => <p key={reason} className="mt-2 text-sm text-muted-text">{reason}</p>)}
    <div className="mt-4 flex flex-wrap gap-2">
      {!tool.installed ? <Button disabled={busy} onClick={onAdd}>Add tool</Button> : <>
        {tool.enabled && <Link href={toolHref(tool.ref)} className="rounded-pill bg-orange px-4 py-1.5 text-[13px] text-on-accent focus-visible:outline-2 focus-visible:outline-accent-ink">Use tool</Link>}
        {tool.enabled && <Button variant="secondary" disabled={busy} onClick={onPin}>{tool.pinned ? "Unpin" : "Pin to sidebar"}</Button>}
        <Button variant="secondary" disabled={busy} onClick={onManage}>Manage</Button>
      </>}
    </div>
  </article>
}
