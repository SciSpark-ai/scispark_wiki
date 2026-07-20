import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeSearchFn, nodeCountFn, nodeGroupFn } from "@/lib/papers/node-search"

import { maybeAutoRefreshTrending } from "@/lib/trending/auto-refresh"

/**
 * POST /api/skills/trending/auto-refresh — body `{}`, JSON result
 * `{result: "refreshed"|"fresh"|"no-fields"|"backoff"|"failed"}`. The home
 * page's v1 "cron": fire-and-forget on app open, refreshing the cached
 * trending dashboard only when it's stale or field-set-mismatched.
 * "backoff"/"failed" come from maybeAutoRefreshTrending's failure-marker
 * mechanism (see its JSDoc) — a failed orchestrator run never rethrows here,
 * it just reports its status like any other outcome. Builds its own deps
 * server-side (getServerVault() via jsonSkillRoute, loadSettings(vault), a
 * Node searchFn, a real per-week OpenAlex counter) exactly like the refresh
 * route, so the browser never needs its own settings/searchFn/countFn wiring.
 */
export const POST = jsonSkillRoute<Record<string, never>, "refreshed" | "fresh" | "no-fields" | "backoff" | "failed">(async (_input, vault) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  return maybeAutoRefreshTrending(vault, {
    searchFn: overrides.searchFn ?? nodeSearchFn(),
    countFn: overrides.countFn ?? nodeCountFn(),
    groupFn: overrides.groupFn ?? nodeGroupFn(),
    settings,
    providerOverride: overrides.providerOverride,
  })
})
