"use client"

import { useState } from "react"
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

type RefreshState =
  | { status: "idle" }
  | { status: "running"; stageIndex: number }
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

  async function handleRefresh() {
    setState({ status: "running", stageIndex: 0 })

    try {
      let costUsd = 0

      const consolidation = await consolidate()
      costUsd += consolidation.costUsd ?? 0

      const feed = await refreshFeed((stage) => {
        const stageIndex = STAGE_ORDER.indexOf(stage)
        if (stageIndex >= 0) setState({ status: "running", stageIndex })
      })
      costUsd += feed.costUsd

      setState({ status: "done", costUsd })
      onUpdated(feed)
    } catch (err) {
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
