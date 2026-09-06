import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { CountFn } from "./counts"
import type { TopicGroupFn, TopWorksFn } from "../papers/node-search"
import { readUserModel } from "../usermodel/pages"
import { effectiveTrackedFields } from "./fields"
import { loadTrendingSettings } from "./settings"
import { loadBoard, isStale, anchorsMatchBoard } from "./cache"
import { runTrendingBoard } from "./dashboard"

/**
 * Scheduled/manual auto-refresh helper: refresh the trending board if it is stale for the
 * user's cadence, OR if the cached board was built for a different set of
 * anchor disciplines than the settings now hold (mirrors /trending's own
 * staleness check — see cache.ts's anchorsMatchBoard JSDoc: a cache can be
 * time-fresh but scope-stale after an anchor edit). The home page does not
 * call this automatically; opening the app must never start a paid LLM run.
 *
 * Stored anchors that are EMPTY are not used for the scope comparison: an
 * empty list means "not derived yet / derivation failed", and comparing
 * against it would mark every board scope-stale and refresh (spending
 * strong-tier tokens) on every single app open.
 */
export async function maybeAutoRefreshTrending(
  storage: VaultStorage,
  deps: {
    /** Required: every paper on the board (topic rows + breakout strip) is fetched through it — see RunTrendingBoardOpts.topWorksFn. */
    topWorksFn: TopWorksFn
    topicGroupFn: TopicGroupFn
    fieldGroupFn: TopicGroupFn
    settings: LLMSettings
    now?: () => Date
    providerOverride?: Partial<Record<Tier, LLMProvider>>
    /** Required: the board's prior-count lookups (and so its whole growth column) run through it — see RunTrendingBoardOpts.countFn. */
    countFn: CountFn
  },
): Promise<"refreshed" | "fresh" | "no-fields"> {
  const now = deps.now ?? (() => new Date())
  const [tSettings, userModel, cached] = await Promise.all([
    loadTrendingSettings(storage),
    readUserModel(storage),
    loadBoard(storage),
  ])
  const fields = effectiveTrackedFields(tSettings.fields, userModel.interests)
  if (fields.length === 0) return "no-fields"
  const scopeStale = tSettings.anchors.length > 0 && !anchorsMatchBoard(cached, tSettings.anchors)
  if (!isStale(cached, tSettings.cadence, now()) && !scopeStale) return "fresh"
  await runTrendingBoard(storage, {
    fields,
    topWorksFn: deps.topWorksFn,
    topicGroupFn: deps.topicGroupFn,
    fieldGroupFn: deps.fieldGroupFn,
    countFn: deps.countFn,
    settings: deps.settings,
    providerOverride: deps.providerOverride,
    now: deps.now,
  })
  return "refreshed"
}
