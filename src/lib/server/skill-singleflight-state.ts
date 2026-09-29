import type { FeedResult, FeedStage } from "../skills/feed"
import type { runConsolidation } from "../skills/consolidation"
import type { VaultStorage } from "../vault/storage"

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
 * as required by Next.js, with independent state for each profile's vault.
 */
interface SkillSingleFlightState {
  feed: ActiveFeedRefresh | null
  consolidation: Promise<ConsolidationRunResult> | null
}
let states = new WeakMap<VaultStorage, SkillSingleFlightState>()

export function skillSingleFlightFor(vault: VaultStorage): SkillSingleFlightState {
  let state = states.get(vault)
  if (!state) { state = { feed: null, consolidation: null }; states.set(vault, state) }
  return state
}

/** Test isolation hooks. They never cancel provider work. */
export function resetFeedRefreshForTests(): void {
  states = new WeakMap()
}

export function resetConsolidationForTests(): void {
  states = new WeakMap()
}
