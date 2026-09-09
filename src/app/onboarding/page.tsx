"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow"
import { loadOnboarding } from "@/lib/onboarding/client"
import type { OnboardingState } from "@/lib/onboarding/contract"
import { useUserStore } from "@/stores/user-store"
import styles from "./onboarding.module.css"

export default function OnboardingPage() {
  const router = useRouter()
  const [state, setState] = useState<OnboardingState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    loadOnboarding().then((next) => {
      if (cancelled) return
      if (next.onboarded) router.replace("/setup")
      else if (!next.connected) router.replace("/setup")
      else setState(next)
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => { cancelled = true }
  }, [router])

  return <div className={`${styles.page} bg-page-warm px-3 sm:px-8`}>
    {error ? <div role="alert" className="text-center text-[14px] text-espresso">
      <p>{error}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 text-orange underline">Reload conversation</button>
      <Link href="/settings" className="ml-4 text-orange underline">AI settings</Link>
    </div> : !state ? <p role="status" className="text-center text-[14px] text-muted-text">Opening your conversation…</p> : (
      <div className={styles.content}>
        <header className={`${styles.intro} text-center`}>
          <p className="text-[13px] font-medium text-orange">Welcome to SciSpark</p>
          <h1 className={`${styles.title} font-heading text-[28px] leading-tight tracking-heading text-espresso sm:text-[38px]`}>Let’s find the work worth your attention.</h1>
          <p className={`${styles.description} text-[14px] leading-relaxed text-muted-text`}>Tell Sparky about your research. We’ll shape your first feed together.</p>
        </header>
        <OnboardingFlow initial={state} onComplete={(name) => {
          useUserStore.getState().setUser({ name })
          useUserStore.getState().setOnboardingComplete(true)
          router.push("/setup")
        }} />
      </div>
    )}
  </div>
}
