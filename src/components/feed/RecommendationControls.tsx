"use client"

import type { RecommendationPreferences } from "@/lib/recommendation/contract"

const MODES = [
  ["focused", "Focused", "Keep it focused."],
  ["balanced", "Balanced", "Add nearby ideas."],
  ["exploratory", "Exploratory", "Explore more."],
] as const

export function RecommendationControls({ value, onChange, disabled = false, allowReset = false }: {
  value: RecommendationPreferences
  onChange: (value: RecommendationPreferences) => void
  disabled?: boolean
  allowReset?: boolean
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 text-[13px] text-espresso">
      <legend className="mb-3 font-medium">How widely should Sparky explore?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map(([mode, label, description]) => (
          <label key={mode} className={`flex min-w-0 cursor-pointer items-start gap-2 rounded-[12px] border p-3 ${value.diversity === mode ? "border-orange bg-card-surface" : "border-border-warm bg-light-surface"}`}>
            <input type="radio" name="recommendation-diversity" value={mode} checked={value.diversity === mode} onChange={() => onChange({ ...value, diversity: mode })} className="mt-0.5 accent-orange" />
            <span><span className="block font-medium">{label}</span><span className="mt-1 block text-[12px] leading-relaxed text-muted-text">{description}</span></span>
          </label>
        ))}
      </div>
      <label className="flex items-start gap-2 py-1">
        <input type="checkbox" checked={value.learnFromFeedback} onChange={(event) => onChange({ ...value, learnFromFeedback: event.target.checked })} className="mt-0.5 accent-orange" />
        <span>Learn from my explicit paper feedback<span className="mt-1 block text-[12px] text-muted-text">Remember likes, dislikes and your reasons.</span><span className="block text-[12px] text-muted-text">Your profile answers stay yours.</span></span>
      </label>
      {allowReset && <button type="button" onClick={() => onChange({ ...value, resetAt: new Date().toISOString() })} className="text-[12px] text-accent-ink underline underline-offset-4">Reset learned preferences on Save</button>}
      {allowReset && value.resetAt && <p className="text-[12px] text-muted-text">Feedback before {new Date(value.resetAt).toLocaleString()} will not influence ranking. History keeps the original records.</p>}
    </fieldset>
  )
}
