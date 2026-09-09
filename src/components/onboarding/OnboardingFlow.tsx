"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { ArrowLeft, ArrowUp, Sparkles } from "lucide-react"
import type { OnboardingAnswers } from "@/lib/usermodel/pages"
import { ProgressiveText } from "@/components/chat/ProgressiveText"
import { RecommendationControls } from "@/components/feed/RecommendationControls"
import { DEFAULT_RECOMMENDATION_PREFERENCES } from "@/lib/recommendation/contract"

interface Question {
  key: Exclude<keyof OnboardingAnswers, "recommendations">
  prompt: (answers: OnboardingAnswers) => string
  placeholder: string
  required: boolean
  singleLine?: boolean
}

const QUESTIONS: Question[] = [
  {
    key: "name",
    prompt: () => "Hi, I’m Sparky — your research companion. What should I call you?",
    placeholder: "Your name",
    required: true,
    singleLine: true,
  },
  {
    key: "role",
    prompt: (answers) => `Nice to meet you, ${answers.name || "there"}. What kind of researcher are you?`,
    placeholder: "For example: PhD student studying pediatric language and neuroimaging",
    required: true,
  },
  {
    key: "fields",
    prompt: () => "Which research worlds should I keep close to us?",
    placeholder: "Fields you work in or actively follow",
    required: true,
  },
  {
    key: "topics",
    prompt: () => "What questions, methods, or topics are especially alive for you right now?",
    placeholder: "Add a few topics — one per line works well",
    required: false,
  },
  {
    key: "feedPrefs",
    prompt: () => "Last thing: what makes a paper feed genuinely useful to you?",
    placeholder: "For example: prioritize methods, include preprints, bring me adjacent ideas",
    required: false,
  },
]

interface OnboardingFlowProps {
  onSubmit: (answers: OnboardingAnswers) => void
  submitting?: boolean
}

const EMPTY_ANSWERS: OnboardingAnswers = {
  name: "",
  role: "",
  fields: "",
  topics: "",
  feedPrefs: "",
}

function SparkyMark() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange text-white shadow-sm">
      <Sparkles size={17} aria-hidden="true" />
    </span>
  )
}

export function OnboardingFlow({ onSubmit, submitting = false }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ANSWERS)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const preferencesDialog = useRef<HTMLDialogElement | null>(null)

  const question = QUESTIONS[step]
  const isLast = step === QUESTIONS.length - 1
  const value = answers[question.key]
  const canAdvance = !question.required || value.trim().length > 0

  useEffect(() => {
    // Scroll only the transcript, never the page or its fixed composer.
    const history = historyRef.current
    if (history) history.scrollTop = history.scrollHeight
  }, [step])

  function handleChange(nextValue: string) {
    setAnswers((previous) => ({ ...previous, [question.key]: nextValue }))
  }

  function handleNext() {
    if (!canAdvance || submitting) return
    if (isLast) {
      onSubmit({
        name: answers.name.trim(),
        role: answers.role.trim(),
        fields: answers.fields.trim(),
        topics: answers.topics.trim(),
        feedPrefs: answers.feedPrefs.trim(),
        recommendations: answers.recommendations ?? { ...DEFAULT_RECOMMENDATION_PREFERENCES },
      })
      return
    }
    setStep((current) => current + 1)
  }

  function handleBack() {
    if (submitting) return
    setStep((current) => Math.max(0, current - 1))
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    event.preventDefault()
    handleNext()
  }

  return (
    <section aria-label="Chat with Sparky" className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col overflow-hidden rounded-[24px] border border-border-warm bg-light-surface shadow-sm">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-warm/70 px-4 py-3 sm:px-7 sm:py-4 [@media(max-height:480px)]:py-2">
        <SparkyMark />
        <div>
          <p className="text-[14px] font-medium text-espresso">Sparky</p>
          <p className="text-[12px] text-muted-text">Your SciSpark research companion</p>
        </div>
        <span className="ml-auto hidden text-[12px] text-muted-text sm:inline">
          Shaping your research radar
        </span>
      </header>

      <div ref={historyRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-6 [@media(max-height:480px)]:py-2" role="log" aria-label="Onboarding conversation" aria-live="polite">
        <div className="my-auto w-full shrink-0 space-y-5">
          {QUESTIONS.slice(0, step).map((completedQuestion) => (
            <div key={completedQuestion.key} className="space-y-3">
              <div className="flex items-start gap-3">
                <SparkyMark />
                <p className="max-w-[82%] break-words rounded-[4px_18px_18px_18px] bg-card-surface px-4 py-3 text-[14px] leading-relaxed text-espresso">
                  {completedQuestion.prompt(answers)}
                </p>
              </div>
              <div className="flex justify-end">
                <p className="max-w-[82%] break-words whitespace-pre-line rounded-[18px_4px_18px_18px] bg-secondary-dark px-4 py-3 text-[14px] leading-relaxed text-page-bg">
                  {answers[completedQuestion.key] || "I’ll decide later."}
                </p>
              </div>
            </div>
          ))}

          <div className="flex items-start gap-3">
            <SparkyMark />
            <p id={`onboarding-q-${question.key}`} className="max-w-[82%] break-words rounded-[4px_18px_18px_18px] bg-card-surface px-4 py-3 text-[15px] leading-relaxed text-espresso">
              <ProgressiveText key={question.key} text={question.prompt(answers)} />
            </p>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border-warm/70 bg-page-warm/50 px-4 py-3 sm:px-7 sm:py-4">
        <div className="flex items-end gap-3 rounded-[18px] border border-border-warm bg-light-surface p-2 focus-within:border-orange">
          {question.singleLine ? (
            <input
              key={question.key}
              aria-labelledby={`onboarding-q-${question.key}`}
              autoFocus
              value={value}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={question.placeholder}
              disabled={submitting}
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] leading-6 text-espresso outline-none placeholder:text-muted-text disabled:opacity-60"
            />
          ) : (
            <textarea
              key={question.key}
              aria-labelledby={`onboarding-q-${question.key}`}
              autoFocus
              value={value}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={question.placeholder}
              rows={2}
              disabled={submitting}
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-espresso outline-none placeholder:text-muted-text disabled:opacity-60"
            />
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance || submitting}
            aria-label={isLast ? "Create my research space" : "Send answer"}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange text-white transition-colors hover:bg-orange/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:ring-offset-2 focus-visible:ring-offset-light-surface disabled:opacity-40 ${question.singleLine ? "self-center" : "mb-1"}`}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted-text">
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 0 || submitting}
            className="inline-flex items-center gap-1 transition-colors hover:text-espresso disabled:invisible"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            Back
          </button>
          {isLast && !submitting ? <button type="button" onClick={() => preferencesDialog.current?.showModal()} className="text-orange underline underline-offset-4">
            Feed preferences · {answers.recommendations?.diversity ?? "balanced"}
          </button> : <span>
            {submitting
              ? "Saving our conversation…"
              : isLast
                ? "Send to create your research space"
                : `${step + 1} of ${QUESTIONS.length}`}
          </span>}
        </div>
      </div>
      <dialog ref={preferencesDialog} aria-labelledby="onboarding-feed-preferences" className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-card border border-border-warm bg-page-bg p-5 text-espresso backdrop:bg-espresso/40 sm:p-7">
        <h2 id="onboarding-feed-preferences" className="mb-4 font-heading text-[24px]">Your paper recommendations</h2>
        <RecommendationControls value={answers.recommendations ?? DEFAULT_RECOMMENDATION_PREFERENCES} onChange={(recommendations) => setAnswers((previous) => ({ ...previous, recommendations }))} disabled={submitting} />
        <p className="mt-4 text-[12px] text-muted-text">Saved when you finish onboarding.</p>
        <p className="text-[12px] text-muted-text">Change them anytime in Settings.</p>
        <button type="button" onClick={() => preferencesDialog.current?.close()} className="mt-4 rounded-pill bg-orange px-4 py-2 text-[13px] text-white">Done</button>
      </dialog>
    </section>
  )
}
