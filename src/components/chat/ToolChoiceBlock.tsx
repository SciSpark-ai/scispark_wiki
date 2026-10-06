"use client"
import { useRef, useState } from "react"
import Link from "next/link"
import type { ToolChoice, ToolRef } from "@/lib/extensions/contracts"
import { chooseToolRemote, ToolChoiceRemoteConflict } from "@/lib/extensions/client"
import { ToolRunBlock } from "./ToolRunBlock"
export function ToolChoiceBlock({ choice: initial }: { choice: ToolChoice }) {
  const [choice, setChoice] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [runId, setRunId] = useState<string | null>(null)
  const request = useRef<{ tool: ToolRef; operationId: string } | null>(null), sending = useRef(false)
  async function choose(tool: ToolRef) {
    if (sending.current) return
    sending.current = true; setBusy(true); setError(null)
    request.current ??= { tool, operationId: choice.id }
    try { setRunId((await chooseToolRemote(choice.id, request.current.tool, request.current.operationId)).id) }
    catch (error) {
      if (error instanceof ToolChoiceRemoteConflict) { setChoice(error.choice); request.current = null }
      setError(error instanceof Error ? error.message : "Could not select this tool.")
    } finally { sending.current = false; setBusy(false) }
  }
  if (runId) return <ToolRunBlock runId={runId} />
  return <section aria-label="Choose a research tool" className="mt-3 rounded-card border border-border-warm bg-light-surface p-4">
    <p className="mb-3 text-sm text-espresso">{choice.prompt}</p>
    <div className="flex flex-col gap-2">{choice.candidates.map(candidate => <div key={JSON.stringify(candidate.tool)} className="rounded-btn border border-border-warm">
      <button type="button" disabled={busy} onClick={() => choose(candidate.tool)} className="w-full rounded-btn p-3 text-left hover:bg-card-surface focus-visible:outline-2 focus-visible:outline-accent-ink disabled:opacity-50">
        <span className="block text-sm text-espresso">{candidate.name}</span>
        <span className="block text-xs text-muted-text">{candidate.tool.packageId === "scispark.builtin" ? "Built-in tool" : "Imported tool"}</span>
        <span className="mt-1 block text-sm text-muted-text">{candidate.distinction}</span>
      </button>
      <details className="px-3 pb-3 text-xs text-muted-text"><summary className="cursor-pointer">Tool details</summary><p className="mt-2 break-all">{candidate.source} · {candidate.tool.packageId} · {candidate.tool.skillId} · {candidate.tool.version} · {candidate.tool.digest}</p></details>
    </div>)}</div>
    {!choice.candidates.length && <Link href="/tools" className="text-sm text-accent-ink underline">Open Tools</Link>}
    {error && <p role="alert" className="mt-2 text-sm text-espresso">{error}</p>}
  </section>
}
