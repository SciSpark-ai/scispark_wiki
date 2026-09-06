"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { isOnboarded, type OnboardingAnswers } from "@/lib/usermodel/pages"
import { createUserProfileRemote } from "@/lib/usermodel/profile-client"
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow"
import type { VaultStorage } from "@/lib/vault/storage"
import { useUserStore } from "@/stores/user-store"
import styles from "./onboarding.module.css"

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
      await createUserProfileRemote(answers)
      useUserStore.getState().setUser({ name: answers.name })
      useUserStore.getState().setOnboardingComplete(true)
      router.push("/setup")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("already") && message.includes("profile")) {
        setState({ status: "already-onboarded" })
        setSubmitting(false)
      } else {
        setSubmitError(message)
        setSubmitting(false)
      }
    }
  }

  return (
    <div className={`${styles.page} bg-page-warm px-3 sm:px-8`}>
      {state.status === "checking" && <p className="text-[14px] text-muted-text">Loading…</p>}

      {state.status === "error" && <p className="text-[13px] text-red-600">Error: {state.message}</p>}

      {state.status === "already-onboarded" && (
        <div className="text-center">
          <p className="text-[15px] text-espresso mb-4">You&apos;ve already set up your research profile.</p>
          <Link href="/" className="text-[13px] text-orange hover:text-orange/90 tracking-body">
            Go to your feed →
          </Link>
        </div>
      )}

      {state.status === "ready" && (
        <div className={styles.content}>
          <div className={`${styles.intro} text-center`}>
            <p className="text-[13px] font-medium text-orange">Welcome to SciSpark</p>
            <h1 className={`${styles.title} font-heading text-[28px] leading-tight tracking-heading text-espresso sm:text-[38px]`}>
              Let’s find the work worth your attention.
            </h1>
            <p className={`${styles.description} text-[14px] leading-relaxed text-muted-text`}>
              Sparky will listen for your fields, current questions, and the kinds of papers you want to see.
            </p>
          </div>
          <OnboardingFlow onSubmit={handleSubmit} submitting={submitting} />
          {submitError && <p role="alert" className="max-h-20 shrink-0 overflow-y-auto text-center text-[13px] text-red-600">Error: {submitError}</p>}
        </div>
      )}
    </div>
  )
}
