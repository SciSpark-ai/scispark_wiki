"use client"

import { useId, useState } from "react"
import { engineLabel, type EngineModel, type LocalEngine } from "@/lib/engines/contracts"

// Codex choices come from the installed CLI. Claude's stable aliases are
// documented at https://code.claude.com/docs/en/model-config.
const CLAUDE_MODELS: EngineModel[] = [
  { id: "sonnet", label: "Claude Sonnet" },
  { id: "opus", label: "Claude Opus" },
  { id: "haiku", label: "Claude Haiku" },
]

export function LocalModelPicker({ engine, tier, value, models, loading, onChange }: {
  engine: LocalEngine; tier: "strong" | "fast"; value: string; models?: EngineModel[]; loading: boolean; onChange: (value: string) => void
}) {
  const id = useId()
  const options = engine === "codex" ? models ?? [] : CLAUDE_MODELS
  const [customSelected, setCustomSelected] = useState(false)
  const custom = customSelected || !options.some((option) => option.id === value)
  const allowCustom = engine === "claude-code"
  const missingCatalog = !allowCustom && models === undefined
  const unavailable = !missingCatalog && !allowCustom && !options.some((option) => option.id === value)
  const name = `${engineLabel(engine)} ${tier === "strong" ? "analysis" : "quick"}`
  const inputClass = "mt-1 w-full min-w-0 rounded-btn border border-border-warm bg-card-surface px-3 py-2 text-sm text-espresso focus-visible:outline-2 focus-visible:outline-accent-ink"
  return <div className="min-w-0">
    <label htmlFor={id} className="text-[13px] text-espresso">{tier === "strong" ? "Analysis model" : "Quick-steps model"}</label>
    <select id={id} disabled={missingCatalog} aria-label={`${name} model`} aria-describedby={`${id}-help`} className={inputClass} value={allowCustom && custom ? "__custom__" : value} onChange={(event) => {
      const selected = event.target.value
      setCustomSelected(selected === "__custom__")
      if (selected !== "__custom__") onChange(selected)
    }}>
      {missingCatalog && <option value={value}>{loading ? "Loading available models…" : "Check connection to load models"}</option>}
      {unavailable && <option value={value} disabled>{value} (unavailable)</option>}
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      {allowCustom && <option value="__custom__">Custom model…</option>}
    </select>
    {allowCustom && custom && <label className="mt-2 block text-xs text-muted-text">Custom model ID
      <input aria-label={`${name} custom model ID`} className={`${inputClass} font-mono`} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Enter a model ID" />
    </label>}
    <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-muted-text">{tier === "strong" ? "For in-depth analysis and synthesis." : "For lighter tasks and quick responses."}</p>
  </div>
}
