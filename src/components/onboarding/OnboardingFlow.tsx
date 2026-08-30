"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowUp, Sparkles } from "lucide-react"
import type { OnboardingAnswers } from "@/lib/usermodel/pages"

interface Question {
  key: keyof OnboardingAnswers
  prompt: (answers: OnboardingAnswers) => string
  placeholder: string
  required: boolean
  singleLine?: boolean
}

const QUESTIONS: Question[] = [
  {
    key: "name",
    prompt: () => "Hi, I’m Ember — your research companion. What should I call you?",
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

function EmberMark() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange text-white shadow-sm">
      <Sparkles size={17} aria-hidden="true" />
    </span>
  )
}

export function OnboardingFlow({ onSubmit, submitting = false }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ANSWERS)
  const currentRef = useRef<HTMLDivElement | null>(null)

  const question = QUESTIONS[step]
  const isLast = step === QUESTIONS.length - 1
  const value = answers[question.key]
  const canAdvance = !question.required || value.trim().length > 0

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })
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
      })
      return
    }
    setStep((current) => current + 1)
  }

  function handleBack() {
    if (submitting) return
    setStep((current) => Math.max(0, current - 1))
  }

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col overflow-hidden rounded-[24px] border border-border-warm bg-light-surface shadow-sm">
      <header className="flex items-center gap-3 border-b border-border-warm/70 px-5 py-4 sm:px-7">
        <EmberMark />
        <div>
          <p className="text-[14px] font-medium text-espresso">Ember</p>
          <p className="text-[12px] text-muted-text">Your SciSpark research companion</p>
        </div>
        <span className="ml-auto text-[11px] uppercase tracking-[0.12em] text-muted-text">
          Getting to know you
        </span>
      </header>

      <div className="max-h-[58vh] min-h-[360px] overflow-y-auto px-5 py-6 sm:px-8" role="log" aria-live="polite">
        <div className="space-y-5">
          {QUESTIONS.slice(0, step).map((completedQuestion) => (
            <div key={completedQuestion.key} className="space-y-3">
              <div className="flex items-start gap-3">
                <EmberMark />
                <p className="max-w-[82%] rounded-[4px_18px_18px_18px] bg-card-surface px-4 py-3 text-[14px] leading-relaxed text-espresso">
                  {completedQuestion.prompt(answers)}
                </p>
              </div>
              <div className="flex justify-end">
                <p className="max-w-[82%] whitespace-pre-line rounded-[18px_4px_18px_18px] bg-espresso px-4 py-3 text-[14px] leading-relaxed text-white">
                  {answers[completedQuestion.key] || "I’ll decide later."}
                </p>
              </div>
            </div>
          ))}

          <div ref={currentRef} className="flex items-start gap-3">
            <EmberMark />
            <p id={`onboarding-q-${question.key}`} className="max-w-[82%] rounded-[4px_18px_18px_18px] bg-card-surface px-4 py-3 text-[15px] leading-relaxed text-espresso">
              {question.prompt(answers)}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border-warm/70 bg-page-warm/50 px-5 py-4 sm:px-7">
        <div className="flex items-end gap-3 rounded-[18px] border border-border-warm bg-light-surface p-2 focus-within:border-orange">
          {question.singleLine ? (
            <input
              key={question.key}
              aria-labelledby={`onboarding-q-${question.key}`}
              autoFocus
              value={value}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleNext()
                }
              }}
              placeholder={question.placeholder}
              disabled={submitting}
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] text-espresso outline-none placeholder:text-muted-text disabled:opacity-60"
            />
          ) : (
            <textarea
              key={question.key}
              aria-labelledby={`onboarding-q-${question.key}`}
              autoFocus
              value={value}
              onChange={(event) => handleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  handleNext()
                }
              }}
              placeholder={question.placeholder}
              rows={2}
              disabled={submitting}
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-espresso outline-none placeholder:text-muted-text disabled:opacity-60"
            />
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance || submitting}
            aria-label={isLast ? "Create my research space" : "Send answer"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange text-white transition-colors hover:bg-orange/90 disabled:opacity-40"
          >
            <ArrowUp size={18} aria-hidden="true" />
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
          <span>
            {submitting
              ? "Saving our conversation…"
              : isLast
                ? "Send to create your research space"
                : `${step + 1} of ${QUESTIONS.length}`}
          </span>
        </div>
      </div>
    </section>
  )
}
