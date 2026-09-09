import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeFeedSearchFn } from "@/lib/papers/node-search"
import { runFeed, type FeedStage } from "@/lib/skills/feed"
import {
  skillSingleFlightState,
  type ActiveFeedRefresh,
} from "@/lib/server/skill-singleflight-state"

function broadcast(state: ActiveFeedRefresh, stage: FeedStage): void {
  state.stage = stage
  for (const listener of state.listeners) {
    try {
      listener({ type: "progress", stage })
    } catch {
      // A disconnected stream must not interrupt the shared provider run.
      state.listeners.delete(listener)
    }
  }
}

/**
 * POST /api/skills/feed/refresh — body `{}`, streaming NDJSON progress.
 *
 * The provider pipeline is process-wide single-flight: reloading, navigating,
 * or opening another tab while a refresh is running joins that exact promise
 * and receives its current/future stage instead of paying for duplicate work.
 */
export const POST = ndjsonSkillRoute<Record<string, never>>(async (_input, vault, emit) => {
  const existing = skillSingleFlightState.feed
  if (existing) {
    existing.listeners.add(emit)
    if (existing.stage) emit({ type: "progress", stage: existing.stage })
    try {
      return await existing.promise
    } finally {
      existing.listeners.delete(emit)
    }
  }

  // Start on the next microtask so the active state is visible before any async
  // dependency lookup can yield to a second request.
  const state: ActiveFeedRefresh = {
    stage: null,
    listeners: new Set([emit]),
    promise: Promise.resolve().then(async () => {
      const settings = await loadSettings(vault)
      const overrides = getSkillTestOverrides()
      return runFeed(vault, {
        searchFn: overrides.searchFn ?? nodeFeedSearchFn(),
        settings,
        providerOverride: overrides.providerOverride,
        onStage: (stage) => broadcast(state, stage),
      })
    }),
  }
  skillSingleFlightState.feed = state

  try {
    return await state.promise
  } finally {
    state.listeners.delete(emit)
    if (skillSingleFlightState.feed === state) skillSingleFlightState.feed = null
  }
})
