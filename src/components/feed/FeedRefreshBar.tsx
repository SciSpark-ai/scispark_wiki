"use client"

import { useEffect, useRef, useState } from "react"
import type { VaultStorage } from "@/lib/vault/storage"
import { runFeed, browserSearchFn, type FeedResult } from "@/lib/skills/feed"
import { consolidationDue, runConsolidation } from "@/lib/skills/consolidation"
import { loadSettings } from "@/lib/llm/settings"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"

const STAGE_LABELS = [
  "Formulating strategy…",
  "Searching sources…",
  "Ranking candidates…",
  "Writing explanations…",
]

const STAGE_INTERVAL_MS = 3000

type RefreshState =
  | { status: "idle" }
  | { status: "running"; stageIndex: number }
  | { status: "done"; costUsd: number }
  | { status: "error"; message: string }

/** Refresh control for the real feed: runs Memory-Consolidation first when due,
 * then the feed pipeline, showing coarse staged progress text and the combined
 * spend on completion. Errors (including budget-exceeded / missing-key) render
 * via LlmErrorMessage. */
export function FeedRefreshBar({
  storage,
  onUpdated,
}: {
  storage: VaultStorage
  onUpdated: (feed: FeedResult) => void
}) {
  const [state, setState] = useState<RefreshState>({ status: "idle" })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  function clearStageTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  async function handleRefresh() {
    setState({ status: "running", stageIndex: 0 })
    clearStageTimer()
    // No real progress callbacks from runFeed — advance a coarse stage label on a
    // timer so the user sees the refresh isn't stuck, per the brief's "elapsed-stage
    // heuristic is acceptable" allowance.
    timerRef.current = setInterval(() => {
      setState((prev) =>
        prev.status === "running"
          ? { status: "running", stageIndex: Math.min(prev.stageIndex + 1, STAGE_LABELS.length - 1) }
          : prev,
      )
    }, STAGE_INTERVAL_MS)

    try {
      const settings = await loadSettings(storage)
      let costUsd = 0

      if (await consolidationDue(storage)) {
        const consolidation = await runConsolidation(storage, { settings })
        costUsd += consolidation.costUsd ?? 0
      }

      const feed = await runFeed(storage, { searchFn: browserSearchFn(), settings })
      costUsd += feed.costUsd

      clearStageTimer()
      setState({ status: "done", costUsd })
      onUpdated(feed)
    } catch (err) {
      clearStageTimer()
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  const running = state.status === "running"

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
        {running && <span className="text-[13px] text-muted-text tracking-body">{STAGE_LABELS[state.stageIndex]}</span>}
        {state.status === "done" && (
          <span className="text-[13px] text-muted-text tracking-body">
            This refresh cost ≈ ${state.costUsd.toFixed(2)}
          </span>
        )}
      </div>
      {state.status === "error" && <LlmErrorMessage message={state.message} />}
    </div>
  )
}
