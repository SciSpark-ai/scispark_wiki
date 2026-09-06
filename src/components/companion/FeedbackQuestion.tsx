"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { useCompanionStore, type CompanionStore } from "@/stores/companion-store"
import { FEEDBACK_LABELS, type FeedbackReason } from "@/lib/recommendation/contract"
import { sendRecommendationFeedback } from "@/lib/recommendation/client"
import { loadCompanionSettingsRemote } from "@/lib/companion/settings-client"
import { COMPANION } from "@/lib/companion/persona"

const REASONS: FeedbackReason[] = ["not_my_topic", "wrong_method", "too_old", "already_know", "other"]

/** Optional, user-triggered conversation. No model call is needed to ask a
 * concrete question or persist the user's own words. Never invent a reason. */
export function FeedbackQuestion({ question }: { question: CompanionStore["feedbackQuestions"][number] }) {
  const [name, setName] = useState(COMPANION.name)
  const [reason, setReason] = useState<FeedbackReason | null>(null)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.focus()
    let active = true
    void loadCompanionSettingsRemote().then((settings) => { if (active) setName(settings.companionName) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  function close() {
    if (busy.current) return
    useCompanionStore.getState().closeFeedback(question.paperKey)
    document.querySelector<HTMLButtonElement>("[data-companion-toggle]")?.focus()
  }
  async function save() {
    if (!reason || busy.current || (reason === "other" && !note.trim())) return
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await sendRecommendationFeedback(question.paperKey, reason, { note: note.trim(), expectedRevision: question.revision })
      setSaved(result.warnings.length
        ? "Saved to your feed memory. History refresh reported a warning; please don't submit again."
        : !result.learningEnabled
          ? "Saved to your feed memory. Learning is off, so this won't shape future recommendations until you turn it on."
          : reason === "already_know"
            ? "Got it. I've recorded that you've read this paper, without treating its topic as a dislike. It will stay in this feed."
            : "Got it. I've saved this to your feed memory for the next refresh.")
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Your reason couldn't be saved. Try again.") }
    finally { busy.current = false; setSaving(false) }
  }
  return <div ref={panel} tabIndex={-1} role="dialog" aria-label={`Paper feedback with ${name}`} aria-busy={saving}
    data-feedback-question
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close() } }}
    className="absolute bottom-full right-0 mb-3 max-h-[calc(100dvh-100px)] w-[min(360px,calc(100vw-40px))] overflow-y-auto overscroll-contain rounded-card border border-border-warm bg-light-surface p-5 text-espresso shadow-lg focus:outline-none">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[14px] font-medium">{name}</p>
      <button type="button" aria-label="Close feedback question" disabled={saving} onClick={close} className="rounded-full p-2 text-muted-text hover:text-espresso focus-visible:ring-2 focus-visible:ring-orange disabled:opacity-40"><X size={16} /></button>
    </div>
    <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-text" title={question.title}>{question.title}</p>
    {saved ? <>
      <p role="status" className="mt-4 text-[14px] leading-relaxed">{saved}</p>
      <button type="button" onClick={close} className="mt-4 rounded-pill bg-orange px-4 py-2 text-[13px] text-white">Done</button>
    </> : <form onSubmit={(event) => { event.preventDefault(); void save() }} className="mt-4 space-y-3">
      <fieldset disabled={saving} className="space-y-2">
        <legend className="mb-3 font-heading text-[22px] leading-tight">What missed the mark?</legend>
        {REASONS.map((value) => <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-[12px] border px-3 py-2.5 text-[13px] ${reason === value ? "border-orange bg-card-surface" : "border-border-warm"}`}>
          <input type="radio" name="paper-feedback-reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="accent-orange" />
          {FEEDBACK_LABELS[value]}
        </label>)}
      </fieldset>
      <label className="block text-[12px] text-muted-text">{reason === "other" ? "Tell me a little more" : "Anything to add? (optional)"}
        <textarea value={note} disabled={saving} maxLength={600} rows={2} onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void save() } }}
          className="mt-1.5 w-full resize-none rounded-[12px] border border-border-warm bg-light-surface px-3 py-2 text-[13px] text-espresso placeholder:text-muted-text focus:border-orange focus:outline-none" />
      </label>
      {error && <p role="alert" className="text-[12px] leading-relaxed">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={!reason || saving || (reason === "other" && !note.trim())} className="rounded-pill bg-orange px-4 py-2 text-[13px] text-white disabled:opacity-40">{saving ? "Saving…" : "Save preference"}</button>
        <button type="button" disabled={saving} onClick={close} className="text-[13px] text-muted-text">Skip</button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-text">Your thumbs down is already saved. A reason is optional.</p>
    </form>}
  </div>
}
