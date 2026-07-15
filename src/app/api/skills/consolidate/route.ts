import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { runConsolidation } from "@/lib/skills/consolidation"

/**
 * POST /api/skills/consolidate — body `{}`, JSON result
 * `{status: "skipped"|"unchanged"|"applied", changesetId?, costUsd?, runId?}`.
 * `runConsolidation` self-gates on due-ness (at least CONSOLIDATION_MIN_EVENTS new
 * events since the last run) and returns `{status: "skipped"}` before spending
 * any LLM call when it isn't due, so this route never needs its own due-ness
 * check. Builds its own deps server-side (getServerVault() via jsonSkillRoute,
 * loadSettings(vault)) exactly like the trending auto-refresh route — the
 * browser never holds LLM keys or runs skills.
 */
export const POST = jsonSkillRoute<Record<string, never>, Awaited<ReturnType<typeof runConsolidation>>>(
  async (_input, vault) => {
    const settings = await loadSettings(vault)
    const overrides = getSkillTestOverrides()
    return runConsolidation(vault, { settings, providerOverride: overrides.providerOverride })
  },
)
