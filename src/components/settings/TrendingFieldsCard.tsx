"use client"

import { useEffect, useState } from "react"
import { getOpenVault } from "@/lib/vault/get-vault"
import { readUserModel } from "@/lib/usermodel/pages"
import { effectiveTrackedFields, slugify, MAX_TRACKED_FIELDS } from "@/lib/trending/fields"
import type { AnchorDiscipline } from "@/lib/trending/anchors"
import type { Cadence } from "@/lib/trending/settings"
import { loadTrendingSettingsRemote, saveTrendingSettingsRemote } from "@/lib/trending/settings-client"
import { Chip } from "@/components/ui/Chip"
import { Button } from "@/components/ui/Button"

/**
 * Moved from `/profile` (Task 5) — same load/save behavior against
 * `/api/settings`'s trending section, seeded from interests.md's Active
 * topics when no explicit fields are saved yet. This is a port, not a
 * redesign: the fields/cadence editor JSX is unchanged from the profile
 * page, just wrapped in a heading consistent with the other settings cards.
 */
export function TrendingFieldsCard() {
  const [trendingLoading, setTrendingLoading] = useState(true)
  const [fieldLabels, setFieldLabels] = useState<string[]>([])
  const [cadence, setCadence] = useState<Cadence>("weekly")
  // Anchors are usually derived automatically (the board orchestrator writes
  // them via saveDerivedAnchors on refresh); this card lets the user remove
  // one by hand or reset back to auto-derivation. Because a save here
  // round-trips the WHOLE TrendingSettings object (saveTrendingSettingsRemote
  // replaces the trending section), every save must carry the current
  // anchors/anchorsOverridden through, whether or not this session touched
  // them — dropping either silently wipes it.
  const [anchors, setAnchors] = useState<AnchorDiscipline[]>([])
  const [anchorsOverridden, setAnchorsOverridden] = useState(false)
  const [trendingStatus, setTrendingStatus] = useState<string | null>(null)
  const [trendingError, setTrendingError] = useState<string | null>(null)
  const [trendingSaving, setTrendingSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // interests.md seeds the default field list when no explicit settings
      // are saved yet; a failure here just means no seed (settings load
      // still proceeds independently).
      let interests: string | null = null
      try {
        const vault = await getOpenVault()
        const userModel = await readUserModel(vault)
        interests = userModel.interests
      } catch {
        // no seed available — settings load below still runs
      }

      try {
        const settings = await loadTrendingSettingsRemote()
        if (cancelled) return
        const fields = effectiveTrackedFields(settings.fields, interests)
        setFieldLabels(fields.map((f) => f.label))
        setCadence(settings.cadence)
        setAnchors(settings.anchors)
        setAnchorsOverridden(settings.anchorsOverridden)
      } catch (e) {
        if (!cancelled) setTrendingError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setTrendingLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function handleFieldLabelChange(index: number, value: string) {
    setFieldLabels((prev) => prev.map((label, i) => (i === index ? value : label)))
  }

  function handleAddField() {
    setFieldLabels((prev) => (prev.length >= MAX_TRACKED_FIELDS ? prev : [...prev, ""]))
  }

  function handleRemoveField(index: number) {
    setFieldLabels((prev) => prev.filter((_, i) => i !== index))
  }

  function handleRemoveAnchor(id: string) {
    setAnchors((prev) => prev.filter((a) => a.id !== id))
    setAnchorsOverridden(true)
  }

  function handleResetAnchors() {
    setAnchors([])
    setAnchorsOverridden(false)
  }

  async function handleSaveTrendingFields() {
    setTrendingSaving(true)
    setTrendingError(null)
    try {
      const fields = fieldLabels
        .map((label) => label.trim())
        .filter((label) => label.length > 0)
        .map((label) => ({ slug: slugify(label), label }))
        .filter((f) => f.slug.length > 0)
        .slice(0, MAX_TRACKED_FIELDS)
      await saveTrendingSettingsRemote({ fields, cadence, anchors, anchorsOverridden })
      setFieldLabels(fields.map((f) => f.label))
      setTrendingStatus("Saved")
      setTimeout(() => setTrendingStatus(null), 2000)
    } catch (e) {
      setTrendingError(e instanceof Error ? e.message : String(e))
    } finally {
      setTrendingSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-[16px] text-espresso tracking-heading-card">Trending fields</h3>
        <div className="flex items-center gap-3">
          {trendingStatus && <span className="text-[13px] text-orange">{trendingStatus}</span>}
          {trendingError && <span className="text-[13px] text-red-600">{trendingError}</span>}
          <button
            onClick={handleSaveTrendingFields}
            disabled={trendingLoading || trendingSaving}
            className="text-[13px] text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-pill px-4 py-1.5 font-medium transition-colors"
          >
            {trendingSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {trendingLoading ? (
        <p className="text-[14px] text-muted-text">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Anchor disciplines
            </label>
            <p className="text-[13px] text-muted-text mb-2">
              The broad fields the trending board is scoped to. Derived automatically from your interests below —
              remove one by hand if it&rsquo;s off, or reset back to auto-derivation.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {anchors.length === 0 ? (
                <span className="text-[13px] text-muted-text">
                  None set yet — derived automatically on the next refresh.
                </span>
              ) : (
                anchors.map((anchor) => (
                  <Chip key={anchor.id} className="inline-flex items-center gap-1.5">
                    {anchor.label}
                    <button
                      type="button"
                      onClick={() => handleRemoveAnchor(anchor.id)}
                      aria-label={`Remove ${anchor.label}`}
                      className="text-muted-text hover:text-red-600 leading-none"
                    >
                      ×
                    </button>
                  </Chip>
                ))
              )}
              <Button type="button" variant="quiet" size="sm" onClick={handleResetAnchors}>
                Reset to auto
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Your interests (the lens)
            </label>
            <p className="text-[13px] text-muted-text mb-2">
              These narrow labels don&rsquo;t bound the board — they highlight relevant rows within the anchor disciplines
              above.
            </p>
            <div className="space-y-2">
              {fieldLabels.map((label, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => handleFieldLabelChange(index, e.target.value)}
                    placeholder="e.g. Retrieval-Augmented Generation"
                    className="flex-1 bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"
                  />
                  <button
                    onClick={() => handleRemoveField(index)}
                    className="text-[13px] text-muted-text hover:text-red-600 rounded-pill border border-border-warm px-3 py-1.5 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {fieldLabels.length < MAX_TRACKED_FIELDS && (
              <button onClick={handleAddField} className="mt-2 text-[13px] text-orange hover:underline">
                + Add field
              </button>
            )}
          </div>

          <div className="flex items-center justify-between py-2">
            <span className="text-[14px] text-espresso">Refresh cadence</span>
            <div className="flex">
              <button
                onClick={() => setCadence("daily")}
                className={`px-3 py-1.5 text-[13px] font-medium first:rounded-l-[8px] last:rounded-r-[8px] ${
                  cadence === "daily" ? "bg-orange text-white" : "bg-card-surface text-muted-text"
                }`}
              >
                Daily
              </button>
              <button
                onClick={() => setCadence("weekly")}
                className={`px-3 py-1.5 text-[13px] font-medium first:rounded-l-[8px] last:rounded-r-[8px] ${
                  cadence === "weekly" ? "bg-orange text-white" : "bg-card-surface text-muted-text"
                }`}
              >
                Weekly
              </button>
            </div>
          </div>

          <p className="text-[12px] text-muted-text">
            A refresh costs roughly 25–30 OpenAlex credits — comfortable with a free API key (1,000/day), about
            three refreshes a day without one (100/day).
          </p>
        </div>
      )}
    </div>
  )
}
