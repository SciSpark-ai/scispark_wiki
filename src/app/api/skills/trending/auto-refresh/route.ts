import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeSearchFn, nodeCountFn, nodeTopicGroupFn, nodeTopicFieldGroupFn } from "@/lib/papers/node-search"

import { maybeAutoRefreshTrending } from "@/lib/trending/auto-refresh"

/**
 * POST /api/skills/trending/auto-refresh — body `{}`, JSON result
 * `{result: "refreshed"|"fresh"|"no-fields"}`. The home page's v1 "cron":
 * fire-and-forget on app open, refreshing the cached trending board only
 * when it's stale or anchor-scope-mismatched. Builds its own deps server-side
 * (getServerVault() via jsonSkillRoute, loadSettings(vault), a Node searchFn,
 * a real OpenAlex work counter, and the two `group_by` groupers) exactly
 * like the refresh route, so the browser never needs its own
 * settings/searchFn/counter wiring.
 */
export const POST = jsonSkillRoute<Record<string, never>, "refreshed" | "fresh" | "no-fields">(async (_input, vault) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  return maybeAutoRefreshTrending(vault, {
    searchFn: overrides.searchFn ?? nodeSearchFn(),
    countFn: overrides.countFn ?? nodeCountFn(),
    topicGroupFn: overrides.topicGroupFn ?? nodeTopicGroupFn(),
    fieldGroupFn: overrides.fieldGroupFn ?? nodeTopicFieldGroupFn(),
    settings,
    providerOverride: overrides.providerOverride,
  })
})
