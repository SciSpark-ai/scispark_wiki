"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/Button"
import type { SourceId } from "@/lib/papers/types"
import { PAPER_SOURCE_OPTIONS } from "@/lib/papers/source-settings-types"
import { enabledSourcesSchema } from "@/lib/papers/source-preferences"

export function PaperSourceSelection({ initialSources }: { initialSources: SourceId[] }) {
  const [selected, setSelected] = useState(initialSources)
  const [saved, setSaved] = useState(initialSources)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const changed = selected.length !== saved.length || selected.some((source) => !saved.includes(source))

  async function save() {
    if (inFlight.current || !selected.length || !changed) return
    inFlight.current = true
    setBusy(true); setNotice(null); setError(null)
    try {
      const response = await fetch("/api/settings/paper-sources", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledSources: selected }), signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error("save failed")
      const sources = enabledSourcesSchema.parse((await response.json()).enabledSources)
      setSaved(sources); setSelected(sources)
      setNotice("Sources saved. They’ll be used for your next feed and search.")
      window.dispatchEvent(new Event("paper-sources-changed"))
    } catch {
      setError("Could not confirm your source selection. Reopen Paper sources to check before retrying.")
    } finally { inFlight.current = false; setBusy(false) }
  }

  return (
    <form className="space-y-3 border-t border-border-warm pt-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <fieldset disabled={busy} aria-describedby="source-selection-help" className="space-y-3">
        <legend className="text-base font-medium text-espresso">Where to find papers</legend>
        <p id="source-selection-help" className="text-[13px] leading-relaxed text-secondary-dark">
          <span className="block">Choose sources for your feed and Search.</span>
          <span className="block">Your existing papers will stay where they are.</span>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAPER_SOURCE_OPTIONS.map(({ id, label, description }) => (
            <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-btn border p-3 ${selected.includes(id) ? "border-orange/60 bg-card-surface" : "border-border-warm"}`}>
              <input type="checkbox" checked={selected.includes(id)} aria-label={label}
                onChange={() => {
                  setSelected((current) => current.includes(id) ? current.filter((source) => source !== id) : [...current, id])
                  setNotice(null); setError(null)
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-espresso">{label}</span>
                <span className="mt-1 block text-[12px] leading-relaxed text-muted-text">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {!selected.length && <p role="alert" className="text-[13px] text-espresso">Choose at least one source.</p>}
      <Button type="submit" disabled={busy || !selected.length || !changed}>{busy ? "Saving sources…" : "Save sources"}</Button>
      {notice && <p role="status" className="text-[13px] leading-relaxed text-secondary-dark">{notice}</p>}
      {error && <p role="alert" className="text-[13px] leading-relaxed text-espresso">{error}</p>}
    </form>
  )
}
