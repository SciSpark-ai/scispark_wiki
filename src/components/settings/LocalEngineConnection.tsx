"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { DEFAULT_ENGINES, engineLabel, type EngineSettings, type EngineStatus, type LocalEngine } from "@/lib/engines/contracts"
import { checkLocalEngine } from "@/lib/engines/client"
import { patchSettings } from "@/lib/llm/settings-client"
import type { ConnectedAi } from "./ConnectAiCard"

export function LocalEngineConnection({ engine, settings, onSaved, onConnected, firstRun }: {
  engine: LocalEngine; settings?: EngineSettings; onSaved: (settings: EngineSettings) => void
  onConnected?: (connection: ConnectedAi) => void; firstRun: boolean
}) {
  const current = settings ?? DEFAULT_ENGINES
  const [models, setModels] = useState(current.models[engine])
  const [timeout, setTimeoutSeconds] = useState(current.timeoutSeconds)
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const inputClass = "mt-1 w-full rounded-btn border border-border-warm bg-card-surface px-3 py-2 text-sm text-espresso focus-visible:outline-2 focus-visible:outline-accent-ink"
  async function check() {
    const result = await checkLocalEngine(engine)
    setStatus(result)
    return result
  }
  async function run(save: boolean, test: boolean) {
    setBusy(true); setMessage("")
    try {
      const result = await check()
      if (!save || result.state !== "ready") return
      const next = { ...current, kind: engine, models: { ...current.models, [engine]: models }, timeoutSeconds: timeout }
      await patchSettings({ engines: next }); onSaved(next)
      if (test) {
        const res = await fetch("/api/settings/test-connection", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
        const body = await res.json() as { result?: { status: string; error?: string }; error?: string }
        if (!res.ok || body.result?.status !== "ok") throw new Error(body.result?.error ?? body.error ?? "The engine test did not complete.")
      }
      setMessage(test ? "Both model tiers passed. Connection saved." : `${engineLabel(engine)} is now your AI engine. No model call was made.`)
      onConnected?.({ provider: engine === "codex" ? "openai" : "anthropic", providerLabel: engineLabel(engine), model: models.strong })
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not connect the engine.") }
    finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <p className="text-[13px] leading-relaxed text-muted-text">Use your signed-in {engineLabel(engine)} CLI on this computer. Sign in in your terminal with <code>{engine === "codex" ? "codex login" : "claude auth login"}</code>, then check the connection.</p>
    <p className="text-[13px] leading-relaxed text-muted-text">Selected research context is sent to the provider. Calls use your subscription limits, which SciSpark cannot measure as a dollar budget. API fallback is off. The agent receives supplied context; SciSpark handles sources and saves.</p>
    <fieldset disabled={busy} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[13px] text-espresso">Analysis model<input aria-label={`${engineLabel(engine)} analysis model`} className={inputClass} value={models.strong} onChange={(e) => setModels({ ...models, strong: e.target.value })} /></label>
        <label className="text-[13px] text-espresso">Quick-steps model<input aria-label={`${engineLabel(engine)} quick model`} className={inputClass} value={models.fast} onChange={(e) => setModels({ ...models, fast: e.target.value })} /></label>
      </div>
      <label className="block text-[13px] text-espresso">Timeout per request (seconds)<input type="number" min={30} max={600} className={inputClass} value={timeout} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} /></label>
      <p className="text-xs leading-relaxed text-muted-text">Output-token limits are approximate for local agents. Requests stop at the timeout; usage may already have been consumed. Status checks do not verify model access.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void run(false, false)} className="rounded-pill border border-border-warm px-4 py-2 text-sm text-espresso">Check connection</button>
        <button type="button" disabled={!models.fast.trim() || !models.strong.trim()} onClick={() => void run(true, false)} className="rounded-pill bg-orange px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-40">{firstRun ? "Connect & continue" : `Use ${engineLabel(engine)}`}</button>
        {!firstRun && <button type="button" onClick={() => void run(true, true)} className="text-sm text-muted-text underline">Save & test models (uses plan)</button>}
        {busy && <Loader2 size={16} aria-label="Checking engine" className="animate-spin text-muted-text" />}
      </div>
    </fieldset>
    {status && <p role="status" className="text-sm leading-relaxed text-espresso">{status.version ? `${engineLabel(engine)} ${status.version}. ` : ""}{status.message}</p>}
    {message && <p role="status" className="text-sm leading-relaxed text-espresso">{message}</p>}
  </div>
}
