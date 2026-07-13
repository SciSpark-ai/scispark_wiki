"use client"

import { useState } from "react"
import type { OnboardingAnswers } from "@/lib/usermodel/pages"

interface Question {
  key: keyof OnboardingAnswers
  prompt: string
  placeholder: string
  required: boolean
}

const QUESTIONS: Question[] = [
  {
    key: "role",
    prompt: "Who are you as a researcher?",
    placeholder: "e.g. PhD student in computational biology at …",
    required: true,
  },
  {
    key: "fields",
    prompt: "Which fields and areas do you work in or follow?",
    placeholder: "e.g. computational biology, machine learning, genomics",
    required: true,
  },
  {
    key: "topics",
    prompt: "Any specific topics, methods, or open questions you're tracking right now?",
    placeholder: "e.g. protein structure prediction, diffusion models, in-context learning",
    required: false,
  },
  {
    key: "feedPrefs",
    prompt: "What does a great paper feed look like for you?",
    placeholder: 'e.g. "mostly methods papers", "include preprints", "surprise me with adjacent fields"',
    required: false,
  },
]

interface OnboardingFlowProps {
  onSubmit: (answers: OnboardingAnswers) => void
  submitting?: boolean
}

export function OnboardingFlow({ onSubmit, submitting = false }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    role: "",
    fields: "",
    topics: "",
    feedPrefs: "",
  })

  const question = QUESTIONS[step]
  const isLast = step === QUESTIONS.length - 1
  const value = answers[question.key]
  const canAdvance = !question.required || value.trim().length > 0

  function handleChange(v: string) {
    setAnswers((prev) => ({ ...prev, [question.key]: v }))
  }

  function handleNext() {
    if (!canAdvance || submitting) return
    if (isLast) {
      onSubmit(answers)
    } else {
      setStep((s) => s + 1)
    }
  }

  function handleBack() {
    if (submitting) return
    setStep((s) => Math.max(0, s - 1))
  }

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="flex items-center justify-center gap-2 mb-8">
        {QUESTIONS.map((q, i) => (
          <span
            key={q.key}
            className={`h-1.5 rounded-full transition-all ${
              i === step ? "w-6 bg-orange" : i < step ? "w-1.5 bg-orange/50" : "w-1.5 bg-border-warm"
            }`}
          />
        ))}
      </div>

      <div className="bg-light-surface border border-border-warm rounded-card px-8 py-10">
        <h1 className="font-heading text-[24px] text-espresso tracking-heading mb-6">{question.prompt}</h1>
        <textarea
          key={question.key}
          autoFocus
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={question.placeholder}
          rows={4}
          disabled={submitting}
          className="w-full text-[15px] text-espresso tracking-body placeholder:text-muted-text bg-white border border-border-warm rounded-btn px-4 py-3 focus:outline-none focus:border-orange resize-none disabled:opacity-60"
        />

        <div className="mt-8 flex items-center justify-between">
          {step > 0 ? (
            <button
              type="button"
              onClick={handleBack}
              disabled={submitting}
              className="text-[13px] text-muted-text hover:text-espresso disabled:opacity-50 tracking-body px-4 py-2"
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance || submitting}
            className="text-[14px] text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-pill px-6 py-2.5 font-medium transition-colors"
          >
            {isLast ? (submitting ? "Creating…" : "Create my research profile") : "Next"}
          </button>
        </div>
      </div>
    </div>
  )
}
