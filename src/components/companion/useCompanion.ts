"use client"

import { useCallback, useEffect } from "react"
import { usePathname } from "next/navigation"
import { companionUtteranceRemote } from "@/lib/companion/client"
import { useCompanionStore } from "@/stores/companion-store"

/**
 * Client hook that wires the Research Companion (M7) into an app surface.
 *
 * On mount (and whenever the route changes) it reports the current route plus
 * the anti-Clippy session bookkeeping the companion store already tracks
 * (`sessionShownCount`/`lastShownTs`) to `POST /api/skills/companion`, which
 * assembles the rest of `TriggerState` (feed cache presence, recent Tier-1
 * events, open review-inbox count, the wiki bundle) server-side and runs
 * `runCompanion` there (M11 Task 9 — local-runtime pivot: no vault reads or
 * LLM settings touch the browser from this hook anymore). A non-null result
 * is handed to the store, which shows the mascot bubble.
 *
 * The chattiness budget/cooldown enforcement itself was already entirely
 * inside `runCompanion`/`evaluateTriggers` (session-budget check, per-trigger
 * cooldown via `lastShownTs`) before this task, not in this hook — moving
 * `runCompanion`'s execution server-side moves that enforcement logic with
 * it unchanged; this hook still owns nothing but reporting the two pieces of
 * session state only the client has.
 *
 * Fire-and-forget: this never blocks render, never throws into the caller,
 * and never suspends. `companionUtteranceRemote` only throws on a genuinely
 * failed request (network error, non-2xx) — a real `null` result is a normal
 * outcome, not an error — and this callback wraps the whole thing anyway,
 * since a companion failure must never break the host page.
 *
 * Returns a `reevaluate` function so callers can nudge the companion after
 * an app event that just happened (e.g. a successful ingest) without
 * waiting for the next mount or route change.
 */
export function useCompanion(): () => void {
  const pathname = usePathname()
  // Read bookkeeping directly; only the mascot subscribes to streamed text.
  // Store-owned stream IDs prevent overlapping requests and late replies from
  // reopening a dismissed bubble. Budget accounting happens once per bubble.
  const reevaluate = useCallback(() => {
    const streamId = useCompanionStore.getState().beginStream()
    if (streamId === null) return
    void (async () => {
      try {
        const { sessionShownCount, lastShownTs } = useCompanionStore.getState()

        const utterance = await companionUtteranceRemote({
          route: pathname ?? "/",
          sessionShownCount,
          lastShownTs,
        }, undefined, (draft) => useCompanionStore.getState().updateStream(streamId, draft))

        useCompanionStore.getState().finishStream(streamId, utterance)
      } catch {
        useCompanionStore.getState().finishStream(streamId, null)
        // Fire-and-forget: a companion failure must never break the host page.
      }
    })()
  }, [pathname])

  useEffect(() => {
    reevaluate()
    // Re-evaluate automatically on mount and on route change only; callers
    // invoke the returned `reevaluate` directly for other app events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return reevaluate
}
