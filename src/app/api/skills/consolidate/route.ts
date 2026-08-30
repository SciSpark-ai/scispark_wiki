import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { skillSingleFlightState } from "@/lib/server/skill-singleflight-state"
import { loadSettings } from "@/lib/llm/settings"
import { runConsolidation } from "@/lib/skills/consolidation"

type ConsolidationResult = Awaited<ReturnType<typeof runConsolidation>>

/**
 * POST /api/skills/consolidate — body `{}`, JSON result. Concurrent refresh
 * callers share one due-check/provider run so a reload cannot duplicate the
 * paid pre-refresh consolidation stage.
 */
export const POST = jsonSkillRoute<Record<string, never>, ConsolidationResult>(
  async (_input, vault) => {
    if (skillSingleFlightState.consolidation) return skillSingleFlightState.consolidation

    const promise = Promise.resolve().then(async () => {
      const settings = await loadSettings(vault)
      const overrides = getSkillTestOverrides()
      return runConsolidation(vault, { settings, providerOverride: overrides.providerOverride })
    })
    skillSingleFlightState.consolidation = promise

    try {
      return await promise
    } finally {
      if (skillSingleFlightState.consolidation === promise) skillSingleFlightState.consolidation = null
    }
  },
)
