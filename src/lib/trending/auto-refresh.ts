import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { SearchFn } from "../skills/feed"
import { readUserModel } from "../usermodel/pages"
import { effectiveTrackedFields } from "./fields"
import { loadTrendingSettings } from "./settings"
import { loadDashboard, isStale, fieldsMatchDashboard, runTrendingDashboard } from "./dashboard"

/**
 * v1 "cron": on app open, refresh the trending dashboard if it is stale for the
 * user's cadence, OR if the cached dashboard's panels are for a different field
 * set than currently tracked (mirrors /trending's own staleness check — see
 * dashboard.ts's fieldsMatchDashboard JSDoc: a cache can be time-fresh but
 * field-stale after a /profile settings change). Fire-and-forget from the home
 * page — never blocks render.
 */
export async function maybeAutoRefreshTrending(
  storage: VaultStorage,
  deps: { searchFn: SearchFn; settings: LLMSettings; now?: () => Date; providerOverride?: Partial<Record<Tier, LLMProvider>> },
): Promise<"refreshed" | "fresh" | "no-fields"> {
  const now = deps.now ?? (() => new Date())
  const [tSettings, userModel, cached] = await Promise.all([
    loadTrendingSettings(storage),
    readUserModel(storage),
    loadDashboard(storage),
  ])
  const fields = effectiveTrackedFields(tSettings.fields, userModel.interests)
  if (fields.length === 0) return "no-fields"
  if (!isStale(cached, tSettings.cadence, now()) && fieldsMatchDashboard(cached, fields)) return "fresh"
  await runTrendingDashboard(storage, { fields, searchFn: deps.searchFn, settings: deps.settings, providerOverride: deps.providerOverride, now: deps.now })
  return "refreshed"
}
