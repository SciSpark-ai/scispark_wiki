import { jsonSkillRoute } from "@/lib/server/skill-route"
import { estimateDeepSparkCost } from "@/lib/spark/deep"

export interface EstimateRouteResult {
  costUsd: number
}

/**
 * POST /api/skills/spark/estimate — body `{}`, JSON result `{costUsd}`: the
 * static, documented-approximate Deep Spark cost estimate (see
 * `estimateDeepSparkCost`'s own header comment) shown in the confirm dialog
 * BEFORE a Deep Spark run. No LLM call and no vault access is actually needed
 * to compute it, but the route still goes through `jsonSkillRoute` (and
 * therefore `getServerVault()`) for the same request/response contract as
 * every other skill route, and so a missing/broken vault surfaces the same
 * way here as it would for any other spark action.
 */
export const POST = jsonSkillRoute<Record<string, never>, EstimateRouteResult>(async () => {
  const costUsd = await estimateDeepSparkCost()
  return { costUsd }
})
