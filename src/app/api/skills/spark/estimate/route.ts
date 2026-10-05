import { nativeContext, nativeKey } from "@/lib/server/native-workflow"
import { requireEnabledTool } from "@/lib/extensions/require-tool"
import { jsonSkillRoute } from "@/lib/server/skill-route"
import { estimateDeepSparkCost } from "@/lib/spark/deep"
import { loadSettings, usesLocalEngine } from "@/lib/llm/settings"

export interface EstimateRouteResult {
  costUsd: number | null
}

/** Upfront token-based estimate for the configured strong model. Reads settings
 * without making an AI call; an unknown rate returns null, never a default price. */
const estimate = jsonSkillRoute<Record<string, never>, EstimateRouteResult>(async (_input, vault) => {
  const settings = await loadSettings(vault)
  return { costUsd: usesLocalEngine(settings) ? null : await estimateDeepSparkCost(settings.tierModels.strong.model) }
})

export async function POST(request: Request) {
  try { await requireEnabledTool(await nativeContext(), nativeKey("idea-spark")); return estimate(request) }
  catch { return Response.json({ error: "Idea Spark is not enabled." }, { status: 409 }) }
}
