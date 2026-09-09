import { jsonSkillRoute } from "@/lib/server/skill-route"
import { addCosts, estimateCostUsd } from "@/lib/llm/pricing"
import { loadSettings } from "@/lib/llm/settings"

export interface LintEstimateRouteResult {
  costUsd: number | null
}

// Approximate token counts, not a bill or hard upper bound: one fast screen
// call, then up to MAX_PAIRS strong judges, each reading two page bodies.
// Price the user's configured models, never an unrelated default provider.
// No LLM call is made; if either rate is unknown the total stays unknown.
const MAX_JUDGE_PAIRS = 20
export const POST = jsonSkillRoute<Record<string, never>, LintEstimateRouteResult>(async (_input, vault) => {
  const settings = await loadSettings(vault)
  const screen = estimateCostUsd(settings.tierModels.fast.model, { inputTokens: 6000, outputTokens: 800 })
  const judge = estimateCostUsd(settings.tierModels.strong.model, { inputTokens: 1600, outputTokens: 200 })
  return { costUsd: addCosts(screen, judge === null ? null : judge * MAX_JUDGE_PAIRS) }
})
