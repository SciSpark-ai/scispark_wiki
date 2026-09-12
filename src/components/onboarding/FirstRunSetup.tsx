"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, KeyRound, LibraryBig, Sparkles } from "lucide-react"
import { ConnectAiCard } from "@/components/settings/ConnectAiCard"
import { FeedRefreshBar } from "@/components/feed/FeedRefreshBar"
import { getOpenVault } from "@/lib/vault/get-vault"
import { isOnboarded } from "@/lib/usermodel/pages"
import { loadFeed, type FeedResult } from "@/lib/skills/feed-cache"
import { checkLocalEngine } from "@/lib/engines/client"
import { loadRedactedSettings } from "@/lib/llm/settings-client"

type SetupPhase = "checking" | "connect" | "initializing" | "ready" | "error"

const STEPS = [
  { id: "connect", label: "Connect your AI", detail: "Use an API key or a local AI engine.", icon: KeyRound },
  { id: "profile", label: "Meet Sparky", detail: "Talk about your research and confirm your profile.", icon: Sparkles },
  { id: "feed", label: "Find your first papers", detail: "Build a feed around your interests.", icon: LibraryBig },
] as const

export function FirstRunSetup() {
  const router = useRouter()
  const [phase, setPhase] = useState<SetupPhase>("checking")
  const [error, setError] = useState<string | null>(null)
  const [feed, setFeed] = useState<FeedResult | null>(null)
  const [hasProfile, setHasProfile] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const [onboarded, existingFeed, settings] = await Promise.all([isOnboarded(vault), loadFeed(vault), loadRedactedSettings()])
        if (cancelled) return
        setHasProfile(onboarded)
        if (existingFeed && onboarded) {
          setFeed(existingFeed)
          setPhase("ready")
          return
        }
        const provider = settings.tierModels.strong.provider
        const engine = settings.engines?.kind
        const connected = engine && engine !== "api" ? (await checkLocalEngine(engine)).state === "ready" : !!settings.keys[provider]?.present
        if (cancelled) return
        if (connected && onboarded) setPhase("initializing")
        else setPhase("connect")
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught))
          setPhase("error")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const currentStep = phase === "connect" || phase === "checking" ? 0 : 2

  return (
    <div className="flex min-h-full flex-col justify-center bg-page-warm px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-[1040px]">
        <header className="mx-auto mb-8 max-w-[680px] text-center">
          <div className="mb-3 flex items-center justify-center gap-2 text-[13px] font-medium text-accent-ink">
            <Sparkles size={16} aria-hidden="true" />
            {hasProfile ? "Profile saved" : "Welcome to SciSpark"}
          </div>
          <h1 className="font-heading text-[34px] leading-tight tracking-heading text-espresso sm:text-[44px]">
            Give Sparky a way to think with you.
          </h1>
          <p className="mx-auto mt-3 text-[15px] leading-relaxed text-muted-text [text-wrap:pretty]">
            Connect your AI provider to meet Sparky.
            <span className="block">Then tell us about your research and review your first feed.</span>
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <ol className="rounded-[18px] border border-border-warm bg-page-bg p-5">
            {STEPS.map((step, index) => {
              const Icon = step.icon
              const complete = index < currentStep || phase === "ready"
              const active = index === currentStep && phase !== "ready"
              return (
                <li key={step.id} className="relative flex gap-3 pb-6 last:pb-0">
                  {index < STEPS.length - 1 && <span className="absolute left-[17px] top-9 h-[calc(100%-28px)] w-px bg-border-warm" aria-hidden="true" />}
                  <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${complete ? "border-orange bg-orange text-on-accent" : active ? "border-orange bg-light-surface text-accent-ink" : "border-border-warm bg-light-surface text-muted-text"}`}>
                    {complete ? <Check size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
                  </span>
                  <div className="pt-0.5">
                    <p className={complete || active ? "text-[14px] font-medium text-espresso" : "text-[14px] text-muted-text"}>{step.label}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-text">{step.detail}</p>
                  </div>
                </li>
              )
            })}
          </ol>

          <div>
            {phase === "checking" && (
              <div className="rounded-[18px] border border-border-warm bg-light-surface p-8 text-[14px] text-muted-text" role="status">
                Opening your local setup…
              </div>
            )}

            {phase === "connect" && (
              <ConnectAiCard firstRun onConnected={() => hasProfile ? setPhase("initializing") : router.push("/onboarding")} />
            )}

            {phase === "initializing" && (
              <FeedRefreshBar
                autoStart
                variant="initialization"
                onUpdated={(nextFeed) => setFeed(nextFeed)}
                onComplete={(nextFeed) => {
                  setFeed(nextFeed)
                  setPhase("ready")
                }}
              />
            )}

            {phase === "ready" && (
              <section className="rounded-[18px] border border-border-warm bg-light-surface p-7 sm:p-9">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange text-on-accent">
                  <Check size={22} aria-hidden="true" />
                </span>
                <h2 className="mt-5 font-heading text-[28px] text-espresso">Your research radar is ready.</h2>
                <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-muted-text">
                  Sparky found {feed?.items.length ?? 0} {feed?.items.length === 1 ? "paper" : "papers"} for your first feed. You can refresh or refine your profile at any time.
                </p>
                <Link href="/" className="mt-6 inline-flex rounded-pill bg-orange px-5 py-2.5 text-[14px] font-medium text-on-accent hover:bg-orange/90">
                  Open my feed
                </Link>
              </section>
            )}

            {phase === "error" && (
              <section className="rounded-[18px] border border-border-warm bg-light-surface p-7">
                <h2 className="font-heading text-[24px] text-espresso">SciSpark could not open setup</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-text">{error}</p>
                <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-pill bg-orange px-4 py-2 text-[13px] font-medium text-on-accent hover:bg-orange/90">
                  Try again
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
