"use client"

import { useEffect, useState } from "react"
import type { VaultStorage } from "@/lib/vault/storage"
import type { FeedResult, FeedStage } from "@/lib/skills/feed"
import { refreshFeed, consolidate } from "@/lib/skills/feed-client"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"

const STAGE_ORDER: FeedStage[] = ["strategy", "retrieval", "rank", "rerank"]

const STAGE_LABELS = [
  "Formulating strategy…",
  "Searching sources…",
  "Ranking candidates…",
  "Writing explanations…",
]

type RefreshPhase = "memory" | FeedStage

type RefreshState =
  | { status: "idle" }
  | { status: "running"; phase: RefreshPhase; startedAt: number }
  | { status: "done"; costUsd: number }
  | { status: "error"; message: string }

/** Refresh control for the real feed: POSTs to the consolidation route first
 * (self-gated server-side — a zero-cost no-op when not due), then the
 * feed-refresh route, showing real per-stage progress text (streamed via NDJSON,
 * M11 Task 6 — no more client-side timer heuristic) and the combined spend on
 * completion. Errors (including budget-exceeded / missing-key) render via
 * LlmErrorMessage. `storage` is accepted but unused now that both orchestrators
 * run server-side — kept in the prop type so callers (src/app/page.tsx) don't
 * need to change. */
export function FeedRefreshBar({
  onUpdated,
}: {
  storage: VaultStorage
  onUpdated: (feed: FeedResult) => void
}) {
  const [state, setState] = useState<RefreshState>({ status: "idle" })
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (state.status !== "running") return
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)))
    updateElapsed()
    const interval = window.setInterval(updateElapsed, 1_000)
    return () => window.clearInterval(interval)
  }, [state])

  async function handleRefresh() {
    const startedAt = Date.now()
    setElapsedSeconds(0)
    setState({ status: "running", phase: "memory", startedAt })

    try {
      let costUsd = 0

      const consolidation = await consolidate()
      costUsd += consolidation.costUsd ?? 0

      const feed = await refreshFeed((stage) => {
        if (STAGE_ORDER.includes(stage)) setState({ status: "running", phase: stage, startedAt })
      })
      costUsd += feed.costUsd

      setState({ status: "done", costUsd })
      onUpdated(feed)
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  const running = state.status === "running"
  const progressLabel = state.status === "running"
    ? state.phase === "memory"
      ? "Checking research memory…"
      : STAGE_LABELS[STAGE_ORDER.indexOf(state.phase)]
    : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={running}
          className="text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
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
            This refresh cost ≈ ${state.costUsd.toFixed(2)}
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
