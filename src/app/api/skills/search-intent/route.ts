import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { runSkill } from "@/lib/skills/runner"
import { searchIntentSkill, type SearchSort } from "@/lib/skills/search-intent"

export interface SearchIntentRouteResult {
  /** Ranking the search adapters should apply. Always defined — see below. */
  sort: SearchSort
  costUsd: number | null
}

/**
 * POST /api/skills/search-intent — body `{query}`, JSON result `{sort, costUsd}`.
 * Runs the `fast`-tier Search-Intent Skill server-side (M11 local-runtime: the
 * browser never holds LLM keys) to classify whether the user's query wants
 * RELEVANCE- or RECENCY-ranked results, before the `/papers` box calls
 * `/api/search`. If the skill run is anything but a clean `ok` (missing key,
 * budget exceeded, provider error), we fall back to `"relevance"` — the safe
 * default the adapters already use — so search never fails just because intent
 * classification did. `setSkillTestOverrides` injects a MockProvider in tests.
 */
export const POST = jsonSkillRoute<{ query: string }, SearchIntentRouteResult>(async ({ query }, vault) => {
  const overrides = getSkillTestOverrides()
  const settings = await loadSettings(vault)

  const run = await runSkill({
    skill: searchIntentSkill,
    input: { query },
    storage: vault,
    settings,
    providerOverride: overrides.providerOverride,
  })

  const sort: SearchSort = run.status === "ok" && run.output !== undefined ? run.output.sort : "relevance"
  return { sort, costUsd: run.costUsd }
})
