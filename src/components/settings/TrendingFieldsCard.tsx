"use client"

import { useEffect, useRef, useState } from "react"
import { getOpenVault } from "@/lib/vault/get-vault"
import { readUserModel } from "@/lib/usermodel/pages"
import { effectiveTrackedFields, slugify, MAX_TRACKED_FIELDS } from "@/lib/trending/fields"
import { manualAnchorError, MAX_ANCHORS, type AnchorDiscipline } from "@/lib/trending/anchors"
import { canonicalAnchor } from "@/lib/trending/openalex-fields"
import type { Cadence } from "@/lib/trending/settings"
import { loadTrendingSettingsRemote, saveTrendingSettingsRemote, suggestTrendingFieldsRemote } from "@/lib/trending/settings-client"
import { Button } from "@/components/ui/Button"
import { OpenAlexFieldSelector } from "./OpenAlexFieldSelector"

/** Selected fields scope Trending and guide Feed. Interests highlight Trending. */
export function TrendingFieldsCard() {
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [fieldLabels, setFieldLabels] = useState<string[]>([])
  const [cadence, setCadence] = useState<Cadence>("weekly")
  const [anchors, setAnchors] = useState<AnchorDiscipline[]>([])
  const [anchorsOverridden, setAnchorsOverridden] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [suggestions, setSuggestions] = useState<AnchorDiscipline[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const suggestingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [settings, interests] = await Promise.all([
          loadTrendingSettingsRemote(),
          getOpenVault().then(readUserModel).then((model) => model.interests).catch(() => null),
        ])
        if (cancelled) return
        setFieldLabels(effectiveTrackedFields(settings.fields, interests).map((field) => field.label))
        setCadence(settings.cadence)
        setAnchors(settings.anchors)
        setAnchorsOverridden(settings.anchorsOverridden)
        setLoaded(true)
      } catch {
        if (!cancelled) setError("Could not load your Trending topics. Please retry.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reload])

  const topicError = manualAnchorError({ anchors, anchorsOverridden })
  const markEdited = () => { setStatus(null); setError(null) }

  async function suggest() {
    if (suggestingRef.current) return
    suggestingRef.current = true; setSuggesting(true); setError(null); setSuggestions([])
    try {
      setSuggestions(await suggestTrendingFieldsRemote(fieldLabels.map((label) => label.trim()).filter(Boolean)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not suggest fields. Choose from the list.")
    } finally { suggestingRef.current = false; setSuggesting(false) }
  }

  async function save() {
    if (!loaded || inFlight.current || topicError) return
    inFlight.current = true; setSaving(true); setError(null); setStatus(null)
    try {
      const fields = fieldLabels.map((label) => label.trim()).filter(Boolean)
        .map((label) => ({ slug: slugify(label), label })).filter((field) => field.slug)
        .slice(0, MAX_TRACKED_FIELDS)
      const stored = await saveTrendingSettingsRemote({ fields, cadence,
        anchors: anchors.map((anchor) => ({ ...anchor, label: anchor.label.trim().replace(/\s+/g, " ") })), anchorsOverridden,
      })
      setFieldLabels(stored.fields.map((field) => field.label))
      setAnchors(stored.anchors); setAnchorsOverridden(stored.anchorsOverridden)
      setStatus("Saved. Applies on your next refresh.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your Trending topics. Please retry.")
    } finally { inFlight.current = false; setSaving(false) }
  }

  return (
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-xl text-espresso">Trending fields</h3>
        <Button type="submit" disabled={!loaded || saving || Boolean(topicError)}>{saving ? "Saving…" : "Save"}</Button>
      </div>
      {status && <p role="status" className="text-[13px] leading-relaxed text-secondary-dark">{status}</p>}
      {error && <p role="alert" className="text-[13px] leading-relaxed text-espresso">{error}</p>}
      {loading ? <p role="status" className="text-[13px] text-muted-text">Loading…</p> : !loaded ? (
        <Button type="button" variant="secondary" onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1) }}>Retry</Button>
      ) : (
        <fieldset disabled={saving} className="space-y-6">
          <section aria-labelledby="general-topics-heading" className="space-y-3">
            <h4 id="general-topics-heading" className="text-base font-medium text-espresso">General fields</h4>
            <p className="text-[13px] leading-relaxed text-secondary-dark">
              <span className="inline-block">Choose up to {MAX_ANCHORS} fields.</span>{" "}
              <span className="inline-block">From OpenAlex’s official list.</span>
            </p>
            <OpenAlexFieldSelector anchors={anchors} onChange={(next) => { setAnchors(next); setAnchorsOverridden(true); markEdited() }} />
            <p className="text-[13px] leading-relaxed text-secondary-dark">
              <span className="inline-block">Your selections also guide Home Feed.</span>{" "}
              <span className="inline-block">Related discoveries are still welcome.</span>
            </p>
            <Button type="button" variant="quiet" size="sm" disabled={suggesting || !fieldLabels.some((label) => label.trim())} onClick={() => void suggest()}>
              {suggesting ? "Finding suggestions…" : "Suggest from my interests"}
            </Button>
            {suggestions.length > 0 && <div className="space-y-2">
              <p className="text-[13px] text-secondary-dark">Suggested fields. Choose any to add.</p>
              <div className="flex flex-wrap gap-2">{suggestions.map((suggestion) => (
                <Button key={suggestion.id} type="button" variant="secondary" size="sm"
                  disabled={anchors.length >= MAX_ANCHORS || anchors.some((anchor) => canonicalAnchor(anchor.id)?.id === suggestion.id)}
                  onClick={() => { setAnchors((current) => [...current, suggestion]); setAnchorsOverridden(true); markEdited() }}>
                  {"Add " + suggestion.label}
                </Button>
              ))}</div>
            </div>}
            {topicError && <p role="alert" className="text-[13px] leading-relaxed text-espresso">{topicError}</p>}
          </section>

          <section aria-labelledby="trending-interests-heading" className="space-y-3 border-t border-border-warm pt-5">
            <h4 id="trending-interests-heading" className="text-base font-medium text-espresso">Your interests</h4>
            <p className="text-[13px] leading-relaxed text-secondary-dark">
              <span className="inline-block">Highlight your specific interests.</span>{" "}
              <span className="inline-block">These don’t limit the broader view.</span>
            </p>
            <div className="space-y-2">
              {fieldLabels.map((label, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input type="text" value={label} aria-label={"Interest " + (index + 1)} placeholder="e.g. Auditory attention"
                    onChange={(event) => { setFieldLabels((current) => current.map((item, i) => i === index ? event.target.value : item)); markEdited() }}
                    className="min-w-0 flex-1 rounded-btn border border-border-warm bg-light-surface px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:ring-2 focus:ring-orange"
                  />
                  <Button type="button" variant="quiet" size="sm" aria-label={"Remove interest " + (index + 1)} onClick={() => { setFieldLabels((current) => current.filter((_, i) => i !== index)); markEdited() }}>Remove</Button>
                </div>
              ))}
            </div>
            {fieldLabels.length < MAX_TRACKED_FIELDS && <Button type="button" variant="secondary" size="sm" onClick={() => { setFieldLabels((current) => [...current, ""]); markEdited() }}>Add interest</Button>}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-warm pt-5">
            <span className="text-[14px] text-espresso">Refresh cadence</span>
            <div className="flex" role="group" aria-label="Refresh cadence">
              {(["daily", "weekly"] as const).map((value) => <button key={value} type="button" aria-pressed={cadence === value}
                onClick={() => { setCadence(value); markEdited() }}
                className={"px-3 py-1.5 text-[13px] font-medium first:rounded-l-btn last:rounded-r-btn " + (cadence === value ? "bg-orange text-white" : "bg-card-surface text-muted-text")}
              >{value === "daily" ? "Daily" : "Weekly"}</button>)}
            </div>
          </div>
          <p className="text-[12px] text-muted-text">Changes apply on your next refresh.</p>
        </fieldset>
      )}
    </form>
  )
}
