"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { isOnboarded, seedUserModel, type OnboardingAnswers } from "@/lib/usermodel/pages"
import { logEvent } from "@/lib/events/log"
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow"
import type { VaultStorage } from "@/lib/vault/storage"

type PageState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "already-onboarded" }
  | { status: "error"; message: string }

export default function OnboardingPage() {
  const router = useRouter()
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [state, setState] = useState<PageState>({ status: "checking" })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        if (cancelled) return
        setStorage(vault)
        if (await isOnboarded(vault)) {
          router.replace("/")
          return
        }
        setState({ status: "ready" })
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  async function handleSubmit(answers: OnboardingAnswers) {
    if (!storage) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await seedUserModel(storage, answers)
      await logEvent(storage, { type: "onboarding_completed" })
      router.push("/")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === "user model already seeded") {
        setState({ status: "already-onboarded" })
        setSubmitting(false)
      } else {
        setSubmitError(message)
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-7">
      {state.status === "checking" && <p className="text-[14px] text-muted-text">Loading…</p>}

      {state.status === "error" && <p className="text-[13px] text-red-600">Error: {state.message}</p>}

      {state.status === "already-onboarded" && (
        <div className="text-center">
          <p className="text-[15px] text-espresso mb-4">You've already set up your research profile.</p>
          <Link href="/" className="text-[13px] text-orange hover:text-orange/90 tracking-body">
            Go to your feed →
          </Link>
        </div>
      )}

      {state.status === "ready" && (
        <div className="w-full">
          <div className="text-center mb-8">
            <h2 className="font-heading text-[15px] text-muted-text tracking-heading-card">
              Let's set up your research profile
            </h2>
          </div>
          <OnboardingFlow onSubmit={handleSubmit} submitting={submitting} />
          {submitError && <p className="mt-4 text-center text-[13px] text-red-600">Error: {submitError}</p>}
        </div>
      )}
    </div>
  )
}
