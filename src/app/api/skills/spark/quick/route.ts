import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { runQuickSpark, type QuickSparkResult } from "@/lib/spark/quick"

export interface QuickSparkRouteInput {
  direction: string
  clusterPageIds?: string[]
}

/**
 * POST /api/skills/spark/quick — body `{direction, clusterPageIds?}`, JSON
 * result `QuickSparkResult` (`{seeds, costUsd, runId}`) — the same shape
 * `SparkPanel` used to get back from calling `runQuickSpark` directly. Builds
 * its own deps server-side (`getServerVault()` via `jsonSkillRoute`,
 * `loadSettings(vault)`) — the browser never holds LLM keys or runs skills
 * (M11 local-runtime pivot). `setSkillTestOverrides` lets tests inject a
 * MockProvider instead of real network calls. Mirrors
 * src/app/api/skills/digest/route.ts.
 */
export const POST = jsonSkillRoute<QuickSparkRouteInput, QuickSparkResult>(async (input, vault) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  return runQuickSpark(vault, {
    direction: input.direction,
    clusterPageIds: input.clusterPageIds,
    settings,
    providerOverride: overrides.providerOverride,
  })
})
