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

export function LocalModelPicker({ engine, tier, value, models, onChange }: {
  engine: LocalEngine; tier: "strong" | "fast"; value: string; models?: EngineModel[]; onChange: (value: string) => void
}) {
  const id = useId()
  const options = engine === "codex" ? models ?? [] : CLAUDE_MODELS
  const [customSelected, setCustomSelected] = useState(false)
  const custom = customSelected || !options.some((option) => option.id === value)
  const name = `${engineLabel(engine)} ${tier === "strong" ? "analysis" : "quick"}`
  const inputClass = "mt-1 w-full min-w-0 rounded-btn border border-border-warm bg-card-surface px-3 py-2 text-sm text-espresso focus-visible:outline-2 focus-visible:outline-accent-ink"
  return <div className="min-w-0">
    <label htmlFor={id} className="text-[13px] text-espresso">{tier === "strong" ? "Analysis model" : "Quick-steps model"}</label>
    <select id={id} aria-label={`${name} model`} aria-describedby={`${id}-help`} className={inputClass} value={custom ? "__custom__" : value} onChange={(event) => {
      const selected = event.target.value
      setCustomSelected(selected === "__custom__")
      if (selected !== "__custom__") onChange(selected)
    }}>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      <option value="__custom__">Custom model…</option>
    </select>
    {custom && <label className="mt-2 block text-xs text-muted-text">Custom model ID
      <input aria-label={`${name} custom model ID`} className={`${inputClass} font-mono`} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Enter a model ID" />
    </label>}
    <p id={`${id}-help`} className="mt-1 text-xs leading-relaxed text-muted-text">{tier === "strong" ? "For in-depth analysis and synthesis." : "For lighter tasks and quick responses."}</p>
  </div>
}
