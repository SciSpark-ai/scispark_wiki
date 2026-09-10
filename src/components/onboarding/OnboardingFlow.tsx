"use client"

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { ArrowUp, Loader2 } from "lucide-react"
import { SparkyBadge } from "@/components/brand/SparkyBadge"
import Link from "next/link"
import { draftAnswers, readyForConfirmation, type OnboardingState, type OnboardingInput } from "@/lib/onboarding/contract"
import { loadOnboarding, sendOnboarding } from "@/lib/onboarding/client"
import type { OnboardingAnswers } from "@/lib/usermodel/pages"

const fields = [
  ["name", "Your name"], ["role", "Your research role"], ["fields", "Research fields"],
  ["topics", "Current questions and topics"], ["feedPrefs", "What you want from your feed"],
] as const

export function OnboardingFlow({ initial, onComplete }: { initial: OnboardingState; onComplete: (name: string) => void }) {
  const [state, setState] = useState(initial)
  const [input, setInput] = useState("")
  const [preview, setPreview] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState("")
  const [answers, setAnswers] = useState(() => draftAnswers(initial.draft))
  const historyRef = useRef<HTMLDivElement>(null)
  const stickToEnd = useRef(true)
  const sending = useRef(false)
  const ready = readyForConfirmation(state)
  const suggestions = state.question === "diversity"
    ? ["Stay focused", "A balanced mix", "Bring in nearby ideas"]
    : state.question === "learning" ? ["Yes, remember my feedback", "No, don’t learn from my feedback"] : []

  // Set the new scroll position before layout-driven scroll events can clear
  // the follow flag when the confirmation form replaces the streaming reply.
  useLayoutEffect(() => {
    if (stickToEnd.current && historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight
  }, [state.messages, preview, ready, error, busy])

  async function perform(request: OnboardingInput) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    setPreview("")
    stickToEnd.current = true
    if (request.action === "message") {
      setState((previous) => ({ ...previous, pending: true, messages: [...previous.messages, { role: "user", content: request.message }] }))
      setInput("")
    }
    try {
      const result = await sendOnboarding(request, setPreview)
      setState(result.state)
      setAnswers(draftAnswers(result.state.draft))
      setWarning(result.warnings.map((item) => item.message).join(" "))
      if (result.profile) onComplete(result.profile.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      // The server may have saved the answer (or confirmation) before a lost
      // response. Reconcile before offering a retry, never duplicate the turn.
      try {
        const recovered = await loadOnboarding()
        setState(recovered)
        // A recovered reply may complete the draft. Failed confirmation must
        // retain manual form edits that have not yet been saved on the server.
        if (request.action !== "confirm") setAnswers(draftAnswers(recovered.draft))
        if (recovered.onboarded && recovered.confirmedAnswers) onComplete(recovered.confirmedAnswers.name)
        else if (!recovered.pending && request.action === "message" && recovered.messages.length === state.messages.length) setInput(request.message)
      } catch {
        setError("The connection was interrupted. Reload the conversation before retrying; your answer may already be saved.")
      }
    } finally {
      setPreview("")
      setBusy(false)
      sending.current = false
    }
  }

  function send(value = input) {
    if (!value.trim() || busy || state.pending) return
    void perform({ action: "message", revision: state.revision, message: value.trim() })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    event.preventDefault()
    send()
  }

  return (
    <section aria-label="Chat with Sparky" className="mx-auto flex min-h-0 w-full max-w-[800px] flex-1 flex-col overflow-hidden rounded-[24px] border border-border-warm bg-light-surface">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-warm/70 px-4 py-3 sm:px-7">
        <SparkyBadge size="header" />
        <div><p className="text-[14px] font-medium text-espresso">Sparky</p><p className="text-[12px] text-muted-text">Your research companion</p></div>
        <span className="ml-auto hidden text-[12px] text-muted-text sm:inline">{ready ? "Check your profile" : "Getting to know you"}</span>
      </header>
      <div ref={historyRef} onScroll={() => {
        const node = historyRef.current
        if (node) stickToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
      }} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5 sm:px-7" aria-label="Onboarding conversation">
        <div className="my-auto w-full shrink-0 space-y-4">
          <div role="log" aria-live="polite" className="space-y-4">
            {state.messages.map((message, index) => (
              <div key={index} className={message.role === "user" ? "flex justify-end" : "flex items-start gap-2.5"}>
                {message.role === "assistant" && <SparkyBadge />}
                <p className={`max-w-[85%] break-words whitespace-pre-wrap rounded-[18px] px-4 py-3 text-[14px] leading-relaxed ${message.role === "user" ? "bg-secondary-dark text-page-bg" : "bg-card-surface text-espresso"}`}>{message.content}</p>
              </div>
            ))}
            {busy && <div className="flex items-start gap-2.5"><SparkyBadge state={preview ? "responding" : "thinking"} /><p className="max-w-[85%] whitespace-pre-wrap rounded-[18px] bg-card-surface px-4 py-3 text-[14px] leading-relaxed text-espresso">{preview || <span role="status">Sparky is thinking…</span>}</p></div>}
          </div>
          {ready && !busy && <form aria-label="Review your research profile" onSubmit={(event) => {
            event.preventDefault()
            void perform({ action: "confirm", revision: state.revision, answers })
          }} className="space-y-4 rounded-[18px] border border-border-warm p-4 sm:p-5">
            <div><h2 className="font-heading text-[25px] text-espresso">Does this sound like you?</h2><p className="mt-1 text-[13px] text-muted-text">Edit anything below, or tell Sparky what to change.</p></div>
            {fields.map(([key, label]) => <label key={key} className="block text-[13px] text-espresso">
              {label}
              <textarea required={key === "name" || key === "role" || key === "fields"} rows={key === "name" ? 1 : 2} maxLength={key === "name" ? 100 : key === "role" ? 1000 : key === "fields" ? 2000 : 4000}
                value={answers[key]} onChange={(event) => setAnswers((previous) => ({ ...previous, [key]: event.target.value }))}
                className="mt-1 block w-full resize-y rounded-[10px] border border-border-warm bg-page-bg p-2 text-[14px] text-espresso focus:outline-orange" />
            </label>)}
            <label className="block text-[13px] text-espresso">Topic variety
              <select value={answers.recommendations.diversity} onChange={(event) => setAnswers((previous) => ({ ...previous, recommendations: { ...previous.recommendations, diversity: event.target.value as NonNullable<OnboardingAnswers["recommendations"]>["diversity"] } }))}
                className="mt-1 block w-full rounded-[10px] border border-border-warm bg-page-bg p-2 text-[14px] text-espresso">
                <option value="focused">Stay focused</option><option value="balanced">A balanced mix</option><option value="exploratory">More variety</option>
              </select>
            </label>
            {state.draft.diversityNote && <p className="text-[13px] leading-relaxed text-muted-text">{state.draft.diversityNote}</p>}
            <label className="flex items-start gap-2 text-[13px] text-espresso"><input type="checkbox" checked={answers.recommendations.learnFromFeedback}
              onChange={(event) => setAnswers((previous) => ({ ...previous, recommendations: { ...previous.recommendations, learnFromFeedback: event.target.checked } }))}
              className="mt-0.5 accent-orange" />Remember my feedback for future recommendations</label>
            <p className="text-[12px] leading-relaxed text-muted-text">Your original answers and confirmed profile stay in this vault. You can edit your profile and feedback preferences later.</p>
            <button type="submit" className="rounded-pill bg-orange px-4 py-2.5 text-[14px] font-medium text-on-accent hover:bg-orange/90">Confirm profile & find papers</button>
          </form>}
        </div>
      </div>
      <div className="shrink-0 border-t border-border-warm/70 px-4 py-3 sm:px-7">
        {error && <p role="alert" className="mb-2 max-h-20 overflow-auto text-[13px] text-espresso">{error} <Link href="/settings" className="text-accent-ink underline">AI settings</Link></p>}
        {warning && <p role="status" className="mb-2 max-h-16 overflow-auto text-[12px] text-muted-text">{warning}</p>}
        {state.pending && !busy ? <button type="button" onClick={() => void perform({ action: "retry", revision: state.revision })} className="rounded-pill bg-orange px-4 py-2 text-[14px] text-on-accent">Retry Sparky’s response</button> : (
          <div className="flex items-end gap-2 rounded-[18px] border border-border-warm bg-light-surface p-2 focus-within:border-orange">
            <textarea aria-label="Your reply to Sparky" autoFocus value={input} maxLength={4000} rows={2} disabled={busy}
              onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown}
              placeholder={state.messages.length === 1 ? "Your name" : ready ? "Anything to change?" : "Tell me in your own words"}
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-espresso outline-none placeholder:text-muted-text disabled:opacity-60" />
            <button type="button" aria-label="Send answer" onClick={() => send()} disabled={!input.trim() || busy}
              className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange text-on-accent focus-visible:ring-2 focus-visible:ring-orange disabled:opacity-40">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
        )}
        {!busy && !state.pending && suggestions.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => send(suggestion)} className="rounded-pill border border-border-warm px-3 py-1.5 text-[12px] text-espresso hover:border-orange">{suggestion}</button>)}
        </div>}
        <p className="mt-2 text-[11px] text-muted-text">Enter to send · Shift + Enter for a new line</p>
      </div>
    </section>
  )
}
