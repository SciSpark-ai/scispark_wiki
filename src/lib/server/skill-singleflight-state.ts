import type { FeedResult, FeedStage } from "../skills/feed"
import type { runConsolidation } from "../skills/consolidation"

export type ProgressEmitter = (event: object) => void

export interface ActiveFeedRefresh {
  promise: Promise<FeedResult>
  stage: FeedStage | null
  listeners: Set<ProgressEmitter>
}

type ConsolidationRunResult = Awaited<ReturnType<typeof runConsolidation>>

/**
 * Process-local coordination shared by the two paid refresh routes. Keeping it
 * outside the App Router's special route modules lets those files export only
 * HTTP handlers,
 * as required by Next.js, while preserving one state object per server process.
 */
export const skillSingleFlightState: {
  feed: ActiveFeedRefresh | null
  consolidation: Promise<ConsolidationRunResult> | null
} = {
  feed: null,
  consolidation: null,
}

/** Test isolation hooks. They never cancel provider work. */
export function resetFeedRefreshForTests(): void {
  skillSingleFlightState.feed = null
}

export function resetConsolidationForTests(): void {
  skillSingleFlightState.consolidation = null
}
