"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { DEFAULT_ENGINES, EngineSettingsSchema, engineLabel, type EngineSettings, type EngineStatus, type LocalEngine } from "@/lib/engines/contracts"
import { checkLocalEngine } from "@/lib/engines/client"
import { patchSettings } from "@/lib/llm/settings-client"
import type { ConnectedAi } from "./ConnectAiCard"
import { LocalModelPicker } from "./LocalModelPicker"

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
  const selected = current.kind === engine
  useEffect(() => {
    let alive = true
    void checkLocalEngine(engine).then(result => { if (alive) setStatus(result) }).catch(() => { /* explicit Check connection shows the error */ })
    return () => { alive = false }
  }, [engine])
  const dirty = models.strong.trim() !== current.models[engine].strong || models.fast.trim() !== current.models[engine].fast || timeout !== current.timeoutSeconds
  const candidate = EngineSettingsSchema.safeParse({ ...current, kind: engine, models: { ...current.models, [engine]: models }, timeoutSeconds: timeout })
  const unavailable = engine === "codex" && status?.models ? [...new Set(Object.values(models).map(id => id.trim()).filter(id => !status.models!.some(m => m.id === id)))] : []
  const canSave = candidate.success && (engine !== "codex" || !!status?.models) && unavailable.length === 0
  const inputClass = "mt-1 w-full rounded-btn border border-border-warm bg-card-surface px-3 py-2 text-sm text-espresso focus-visible:outline-2 focus-visible:outline-accent-ink"
  function changeModel(tier: "strong" | "fast", value: string) {
    setModels({ ...models, [tier]: value }); setMessage("")
  }
  async function check() {
    const result = await checkLocalEngine(engine)
    setStatus(result)
    return result
  }
  async function run(save: boolean, test: boolean) {
    if (save && !candidate.success) return
    setBusy(true); setMessage("")
    try {
      const result = await check()
      if (!save || result.state !== "ready" || !candidate.success) return
      const next = candidate.data
      if (engine === "codex") {
        if (!result.models) throw new Error(result.modelsError ?? "Check connection to load this Codex CLI's available models before saving.")
        const unavailable = Object.values(next.models.codex).filter(id => !result.models!.some(m => m.id === id))
        if (unavailable.length) throw new Error(`${[...new Set(unavailable)].join(", ")} is not available in this Codex CLI's model list. Choose an available model below; no model request was sent.`)
      }
      await patchSettings({ engines: next }); onSaved(next); setModels(next.models[engine])
      if (test) {
        const res = await fetch("/api/settings/test-connection", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
        const body = await res.json() as { result?: { status: string; error?: string }; error?: string }
        if (!res.ok || body.result?.status !== "ok") throw new Error(body.result?.error ?? body.error ?? "The engine test did not complete.")
      }
      setMessage(test ? "Both model tiers passed. Connection saved." : selected ? "Models saved for new requests in this profile. No model call was made." : `${engineLabel(engine)} is now your AI engine. No model call was made.`)
      onConnected?.({ provider: engine === "codex" ? "openai" : "anthropic", providerLabel: engineLabel(engine), model: next.models[engine].strong })
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not connect the engine.") }
    finally { setBusy(false) }
  }
  return <div className="space-y-4">
    <p className="text-[13px] leading-relaxed text-muted-text">Use your signed-in {engineLabel(engine)} CLI on this computer. Sign in in your terminal with <code>{engine === "codex" ? "codex login" : "claude auth login"}</code>, then check the connection.</p>
    <p className="text-[13px] leading-relaxed text-muted-text">Selected research context is sent to the provider. Calls use your subscription limits, which SciSpark cannot measure as a dollar budget. API fallback is off. The agent receives supplied context; SciSpark handles sources and saves.</p>
    {selected && <p className="break-words text-[13px] leading-relaxed text-espresso">Saved models: {current.models[engine].strong} (analysis) · {current.models[engine].fast} (quick steps)</p>}
    <fieldset disabled={busy} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <LocalModelPicker engine={engine} tier="strong" value={models.strong} models={status?.models} onChange={(value) => changeModel("strong", value)} />
        <LocalModelPicker engine={engine} tier="fast" value={models.fast} models={status?.models} onChange={(value) => changeModel("fast", value)} />
      </div>
      <p className="text-xs leading-relaxed text-muted-text">Choose the same model for both, or use different models for each step. Model access depends on your account and CLI version; use Custom model for another ID. Saving applies to new requests in this profile.</p>
      {engine === "codex" && <p className="text-xs leading-relaxed text-muted-text">{status?.models ? "Choices come from the Codex CLI installed on this computer." : status?.modelsError ?? "Checking the installed Codex CLI for available models…"}</p>}
      {unavailable.length > 0 && <p role="alert" className="text-sm text-espresso">{unavailable.join(", ")} is not available in this Codex CLI&apos;s model list. Choose an available model; no model request has been sent.</p>}
      <label className="block text-[13px] text-espresso">Timeout per request (seconds)<input aria-label="Timeout per request (seconds)" type="number" min={30} max={600} className={inputClass} value={timeout} onChange={(e) => { setTimeoutSeconds(Number(e.target.value)); setMessage("") }} /></label>
      <p className="text-xs leading-relaxed text-muted-text">Output-token limits are approximate for local agents. Requests stop at the timeout; usage may already have been consumed. Checking the connection does not run an AI request.</p>
      {dirty && <p role="status" className="text-xs text-espresso">Unsaved changes</p>}
      {!candidate.success && <p role="alert" className="text-xs text-espresso">Enter a model ID of 1–150 characters using letters, numbers, dots, dashes, underscores, slashes or colons, starting with a letter or number, and a whole-number timeout from 30 to 600 seconds.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void run(false, false)} className="rounded-pill border border-border-warm px-4 py-2 text-sm text-espresso">Check connection</button>
        <button type="button" disabled={!canSave} onClick={() => void run(true, false)} className="rounded-pill bg-orange px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-40">{firstRun ? "Connect & continue" : selected ? "Save models" : `Use ${engineLabel(engine)}`}</button>
        {!firstRun && <button type="button" disabled={!canSave} onClick={() => void run(true, true)} className="text-sm text-muted-text underline disabled:opacity-40">Save & test models (uses plan)</button>}
        {busy && <Loader2 size={16} aria-label="Checking engine" className="animate-spin text-muted-text" />}
      </div>
    </fieldset>
    {status && <p role="status" className="text-sm leading-relaxed text-espresso">{status.version ? `${engineLabel(engine)} ${status.version}. ` : ""}{status.message}</p>}
    {message && <p role="status" className="text-sm leading-relaxed text-espresso">{message}</p>}
  </div>
}
