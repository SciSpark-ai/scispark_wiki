import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeSearchFn, nodeCountFn, nodeTopicGroupFn, nodeTopicFieldGroupFn } from "@/lib/papers/node-search"

import { runTrendingBoard } from "@/lib/trending/dashboard"
import type { TrackedField } from "@/lib/trending/fields"

interface RefreshInput {
  fields: TrackedField[]
}

/**
 * POST /api/skills/trending/refresh — body `{fields}` (the user's narrow
 * interest labels, which act as the lens and the anchor-derivation input),
 * streams NDJSON progress (`{type:"progress", field}` per anchor discipline,
 * via runTrendingBoard's onProgress) terminating in the full TrendingBoard as
 * the result event. Builds its own deps server-side (per M11's local-runtime
 * pivot: the browser never runs skills or holds LLM keys) — getServerVault()
 * (via ndjsonSkillRoute), loadSettings(vault), a Node searchFn, a real
 * OpenAlex work counter (prior-count lookups + anchor totals), and the two
 * `group_by` groupers behind the leaderboard and anchor derivation — so the client only
 * ever sends the tracked fields. `setSkillTestOverrides` lets tests inject a
 * MockProvider/fake searchFn/countFn/groupers instead of the real network calls.
 */
export const POST = ndjsonSkillRoute<RefreshInput>(async (input, vault, emit) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  return runTrendingBoard(vault, {
    fields: input.fields,
    searchFn: overrides.searchFn ?? nodeSearchFn(),
    countFn: overrides.countFn ?? nodeCountFn(),
    topicGroupFn: overrides.topicGroupFn ?? nodeTopicGroupFn(),
    fieldGroupFn: overrides.fieldGroupFn ?? nodeTopicFieldGroupFn(),
    settings,
    providerOverride: overrides.providerOverride,
    onProgress: (field) => emit({ type: "progress", field }),
  })
})
