"use client"

import { formatCost } from "@/lib/llm/pricing"
import { engineLabel } from "@/lib/engines/contracts"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Loader2 } from "lucide-react"
import type { VaultStorage } from "@/lib/vault/storage"
import type { FeedResult, FeedStage } from "@/lib/skills/feed"
import { refreshFeed } from "@/lib/skills/feed-client"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"

const STAGE_ORDER: FeedStage[] = ["strategy", "retrieval", "rank", "rerank"]

const STAGE_LABELS = [
  "Formulating strategy…",
  "Searching sources…",
  "Ranking candidates…",
  "Preparing your feed…",
]

type RefreshPhase = "memory" | FeedStage

type RefreshState =
  | { status: "idle" }
  | { status: "running"; phase: RefreshPhase; startedAt: number }
  | { status: "done"; costUsd: number | null; billingMode?: "subscription"; engine?: string; unranked?: boolean }
  | { status: "error"; message: string }

/** Refresh the server-owned recommendation pipeline with real NDJSON progress.
 * Explicit profile answers are never rewritten as a refresh side effect.
 * The optional storage prop is retained for backwards-compatible callers. */
export function FeedRefreshBar({
  onUpdated,
  autoStart = false,
  variant = "compact",
  onComplete,
}: {
  storage?: VaultStorage
  onUpdated: (feed: FeedResult) => void
  autoStart?: boolean
  variant?: "compact" | "initialization"
  onComplete?: (feed: FeedResult) => void
}) {
  const [state, setState] = useState<RefreshState>({ status: "idle" })
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const autoStarted = useRef(false)

  useEffect(() => {
    if (state.status !== "running") return
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)))
    updateElapsed()
    const interval = window.setInterval(updateElapsed, 1_000)
    return () => window.clearInterval(interval)
  }, [state])

  const handleRefresh = useCallback(async () => {
    const startedAt = Date.now()
    setElapsedSeconds(0)
    setState({ status: "running", phase: "memory", startedAt })

    try {
      // Explicit profile answers stay user-owned. Feed learning is deterministic
      // and bounded; do not run the legacy profile-rewriting consolidation here.

      const feed = await refreshFeed((stage) => {
        if (STAGE_ORDER.includes(stage)) setState({ status: "running", phase: stage, startedAt })
      })
      setState({ status: "done", costUsd: feed.costUsd, billingMode: feed.billingMode, engine: feed.engine, unranked: feed.recommendation?.status === "unranked" })
      onUpdated(feed)
      onComplete?.(feed)
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }, [onComplete, onUpdated])

  useEffect(() => {
    if (!autoStart || autoStarted.current) return
    const start = window.setTimeout(() => {
      // An effect cleanup can cancel this timer (StrictMode replay or changed
      // callbacks). Only latch once work actually begins, so it can reschedule.
      if (autoStarted.current) return
      autoStarted.current = true
      void handleRefresh()
    }, 0)
    return () => window.clearTimeout(start)
  }, [autoStart, handleRefresh])

  const running = state.status === "running"
  const progressLabel = state.status === "running"
    ? state.phase === "memory"
      ? "Checking research memory…"
      : STAGE_LABELS[STAGE_ORDER.indexOf(state.phase)]
    : null

  if (variant === "initialization") {
    const activeIndex = state.status === "running"
      ? ["memory", ...STAGE_ORDER].indexOf(state.phase)
      : state.status === "done"
        ? STAGE_ORDER.length
        : -1
    const initializationStages = [
      "Checking your research profile",
      "Planning the first search",
      "Searching research sources",
      "Ranking papers for you",
      "Preparing your feed",
    ]

    return (
      <section className="rounded-[18px] border border-border-warm bg-light-surface p-6 sm:p-8" aria-live="polite">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange text-on-accent">
            {state.status === "done" ? <Check size={20} aria-hidden="true" /> : <Loader2 size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          </span>
          <div>
            <h2 className="font-heading text-[24px] text-espresso">
              {state.status === "done" ? "Your research radar is ready" : "Finding your first papers"}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-text" role="status">
              {state.status === "running" ? `${progressLabel} ${elapsedSeconds}s` : state.status === "error" ? "Initialization paused." : "Sparky is preparing a feed around your research profile."}
            </p>
          </div>
        </div>

        <ol className="mt-6 space-y-3">
          {initializationStages.map((label, index) => {
            const complete = activeIndex > index || state.status === "done"
            const active = activeIndex === index && state.status === "running"
            return (
              <li key={label} className="flex items-center gap-3 text-[13px]">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${complete ? "border-orange bg-orange text-on-accent" : active ? "border-orange text-accent-ink" : "border-border-warm text-muted-text"}`}>
                  {complete ? <Check size={12} aria-hidden="true" /> : <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-orange" : "bg-border-warm"}`} />}
                </span>
                <span className={complete || active ? "text-espresso" : "text-muted-text"}>{label}</span>
              </li>
            )
          })}
        </ol>

        {running && elapsedSeconds >= 20 && (
          <p className="mt-5 text-[12px] leading-relaxed text-muted-text">
            Your provider is still working. Keep this page open; SciSpark will show the feed when it is ready.
          </p>
        )}
        {state.status === "error" && (
          <div className="mt-5">
            <LlmErrorMessage message={state.message} />
            <button type="button" onClick={() => void handleRefresh()} className="mt-3 rounded-pill bg-orange px-4 py-2 text-[13px] font-medium text-on-accent hover:bg-orange/90">
              Try initialization again
            </button>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={running}
          className="text-[13px] text-on-accent bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
        >
          {running ? "Refreshing…" : "Refresh feed"}
        </button>
        {running && (
          <span className="text-[13px] text-muted-text tracking-body" role="status" aria-live="polite">
            {progressLabel} · {elapsedSeconds}s
          </span>
        )}
        {state.status === "done" && (
          <span className="text-[13px] text-muted-text tracking-body">
            {state.billingMode === "subscription"
              ? `${state.unranked ? "Refresh finished with unranked results" : "Refresh complete"} · ${engineLabel(state.engine ?? "codex")} plan usage; no API dollar charge recorded.`
              : state.costUsd === null ? "Refresh complete · cost unavailable for this model. Check your provider’s usage." : `This refresh ${formatCost(state.costUsd).toLowerCase()}`}
          </span>
        )}
      </div>
      {running && elapsedSeconds >= 20 && (
        <p className="text-[12px] text-muted-text">
          Your provider is still working. You can keep browsing; another refresh will join this one.
        </p>
      )}
      {state.status === "error" && <LlmErrorMessage message={state.message} />}
    </div>
  )
}
