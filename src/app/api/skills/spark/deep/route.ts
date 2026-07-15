import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeSearchFn } from "@/lib/papers/node-search"
import { runDeepSpark, type DeepSparkResult } from "@/lib/spark/deep"

export interface DeepSparkRouteInput {
  direction: string
  clusterPageIds?: string[]
  seedPageId?: string
}

/**
 * POST /api/skills/spark/deep — body `{direction, clusterPageIds?,
 * seedPageId?}`, streams NDJSON progress (`{type:"progress", phase}` once per
 * pipeline phase, via `runDeepSpark`'s `onPhase`: grounding -> bottleneck ->
 * ideation -> scoop-check -> audit, the last three re-fired once on the
 * single internal abandon-retry) terminating in the full `DeepSparkResult` as
 * the result event. Builds its own deps server-side (`getServerVault()` via
 * `ndjsonSkillRoute`, `loadSettings(vault)`, a Node searchFn) — the browser
 * never holds LLM keys, calls a search API directly, or runs skills (M11
 * local-runtime pivot). A skill run failure inside `runDeepSpark` (LLM error,
 * budget exceeded) throws, so `ndjsonSkillRoute` emits a terminal error line;
 * `do_not_generate`/`abandoned` outcomes are NOT errors — they're normal
 * `DeepSparkResult` values returned as the terminal result, exactly as
 * `SparkPanel` rendered them before this move. Mirrors
 * src/app/api/skills/feed/refresh/route.ts.
 *
 * Concurrency/spend safety: this route itself has no guard against two
 * overlapping requests (e.g. two browser tabs both POSTing here for the same
 * vault) — the guard lives one layer down, in `runDeepSpark` itself
 * (src/lib/spark/deep.ts), which shares one in-flight run per `VaultStorage`
 * via a module-level `WeakMap` (same pattern as
 * src/lib/trending/dashboard.ts's `runTrendingDashboard`). So two concurrent
 * POSTs to this route for the same vault resolve to the SAME `DeepSparkResult`
 * (only one real LLM spend), but the second request's `onPhase` progress
 * events won't fire mid-run — see runDeepSpark's JSDoc for the full nuance.
 */
export const POST = ndjsonSkillRoute<DeepSparkRouteInput>(async (input, vault, emit) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  const today = new Date().toISOString().slice(0, 10)

  const result: DeepSparkResult = await runDeepSpark({
    storage: vault,
    direction: input.direction,
    clusterPageIds: input.clusterPageIds,
    seedPageId: input.seedPageId,
    searchFn: overrides.searchFn ?? nodeSearchFn(),
    settings,
    providerOverride: overrides.providerOverride,
    today,
    onPhase: (phase) => emit({ type: "progress", phase }),
  })
  return result
})
