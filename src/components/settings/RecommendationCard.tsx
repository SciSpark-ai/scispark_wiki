"use client"

import { useEffect, useState } from "react"
import { RecommendationControls } from "@/components/feed/RecommendationControls"
import { DEFAULT_RECOMMENDATION_PREFERENCES, type RecommendationPreferences } from "@/lib/recommendation/contract"
import { loadUserProfile, updateUserProfileRemote } from "@/lib/usermodel/profile-client"
import type { UserProfileDetail } from "@/lib/usermodel/profile"
import { loadRecommendationFeedback } from "@/lib/recommendation/client"
import { FEEDBACK_LABELS, type FeedbackEntry } from "@/lib/recommendation/contract"
import { feedbackPreference } from "@/lib/usermodel/feed-memory"

const preferenceLabels = {
  example: "Similar research", topic: "Topic preference", approach: "Method / population preference",
  recency: "Freshness preference", custom: "Your stated preference",
}

export function RecommendationCard() {
  const [profile, setProfile] = useState<UserProfileDetail | null>(null)
  const [draft, setDraft] = useState<RecommendationPreferences>(DEFAULT_RECOMMENDATION_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [memories, setMemories] = useState<FeedbackEntry[]>([])
  const [memoryError, setMemoryError] = useState<string | null>(null)
  async function reload() {
    setLoading(true)
    try {
      const next = await loadUserProfile()
      setProfile(next)
      setDraft(next?.recommendations ?? DEFAULT_RECOMMENDATION_PREFERENCES)
      setMessage(next ? null : "Complete your research profile before changing recommendations.")
    } catch (error) { setMessage((error as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [])
  useEffect(() => {
    let active = true
    void loadRecommendationFeedback().then((result) => {
      if (active) { setMemories(result.entries.slice().sort((a, b) => b.at.localeCompare(a.at))); setMemoryError(result.warning) }
    }).catch(() => { if (active) setMemoryError("Feed memory could not be loaded. Reopen Settings to try again.") })
    return () => { active = false }
  }, [])
  async function save() {
    if (!profile || saving) return
    setSaving(true)
    try {
      const result = await updateUserProfileRemote({ ...profile, recommendations: draft })
      setProfile(result.result)
      setMessage(result.warnings.length ? "Saved. History refresh reported a warning; do not submit again." : "Saved. These preferences apply on your next feed refresh.")
    } catch (error) { setMessage(`${(error as Error).message} Reload preferences if they were edited elsewhere.`) }
    finally { setSaving(false) }
  }
  return <section className="space-y-4">
    <h2 className="font-heading text-[22px] text-espresso">Paper recommendations</h2>
    <p className="text-[13px] leading-relaxed text-muted-text">Relevance 70% · recency 20% · venue standing 10%. These are initial ranking weights, not a measure of research quality. Missing venue metrics stay neutral.</p>
    {loading ? <p className="text-muted-text">Loading preferences…</p> : profile && <>
      <RecommendationControls value={draft} onChange={setDraft} disabled={saving} allowReset />
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} disabled={saving || JSON.stringify(draft) === JSON.stringify(profile.recommendations ?? DEFAULT_RECOMMENDATION_PREFERENCES)} className="rounded-pill bg-orange px-4 py-2 text-[13px] text-on-accent disabled:opacity-40">{saving ? "Saving…" : "Save preferences"}</button>
        <button type="button" onClick={() => setDraft(profile.recommendations ?? DEFAULT_RECOMMENDATION_PREFERENCES)} disabled={saving} className="text-[13px] text-espresso">Cancel</button>
      </div>
    </>}
    {message && <p role="status" className="text-[13px] text-espresso">{message}</p>}
    <button type="button" onClick={() => void reload()} disabled={saving} className="text-[12px] text-accent-ink underline">Reload preferences</button>
    <section className="space-y-3 border-t border-border-warm pt-4" aria-label="Saved feed memory">
      <h3 className="font-heading text-[20px]">Your feed memory</h3>
      <p className="text-[12px] leading-relaxed text-muted-text">Your feedback stays in your vault. The next feed checks related papers against these preferences. Influence fades with time; it never rewrites your profile. History can undo a saved response.</p>
      {memoryError ? <p role="alert" className="text-[12px] text-espresso">{memoryError}</p> : memories.length ? <ul className="space-y-3">
        {memories.slice(0, 30).map((entry) => {
          const preference = feedbackPreference(entry.reason)
          const savedPreferences = profile?.recommendations ?? DEFAULT_RECOMMENDATION_PREFERENCES
          const paused = !savedPreferences.learnFromFeedback || Boolean(savedPreferences.resetAt && entry.at <= savedPreferences.resetAt) || Date.now() - Date.parse(entry.at) > 180 * 86_400_000
          return <li key={entry.paperKey} className="space-y-1 text-[13px]">
          <p className="font-medium text-espresso">{entry.title}</p>
          <p className="text-muted-text">{FEEDBACK_LABELS[entry.reason]} · {new Date(entry.at).toLocaleDateString()}</p>
          {entry.note && <p className="whitespace-pre-wrap break-words text-espresso">{entry.note}</p>}
          <p className="text-[12px] text-muted-text">{preference ? `${preferenceLabels[preference.facet]} · Related papers only · ${paused ? "Inactive for learning" : "Available for the next refresh"}` : "This paper only · Not used to infer interests"}</p>
        </li>})}
      </ul> : <p className="text-[12px] text-muted-text">No paper feedback yet.</p>}
      {memories.length > 30 && <p className="text-[12px] text-muted-text">Showing the latest 30 responses. Older records remain in your vault.</p>}
    </section>
  </section>
}
