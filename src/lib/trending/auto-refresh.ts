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

/** Where the auto-refresh failure marker lives, sibling to the dashboard cache. */
export const REFRESH_FAILURE_PATH = ".scispark/trending/refresh-failure.json"

interface RefreshFailureMarker {
  lastFailureAt: string
  consecutiveFailures: number
  lastError: string
}

const THIRTY_MIN_MS = 30 * 60 * 1000
const SIX_HOURS_MS = 6 * 60 * 60 * 1000

/**
 * Exponential backoff for consecutive auto-refresh failures: 30min * 2^(n-1),
 * capped at 6h, where n = consecutiveFailures (1-indexed: n=1 is the first
 * failure). Pure. n=1 -> 30min, n=2 -> 1h, n=3 -> 2h, n=5+ -> capped at 6h.
 */
export function backoffMs(consecutiveFailures: number): number {
  return Math.min(THIRTY_MIN_MS * 2 ** (consecutiveFailures - 1), SIX_HOURS_MS)
}

/** Reads and validates the failure marker. Missing or unparseable -> null (treated as no marker). */
async function readFailureMarker(storage: VaultStorage): Promise<RefreshFailureMarker | null> {
  const raw = await storage.read(REFRESH_FAILURE_PATH)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as RefreshFailureMarker).lastFailureAt === "string" &&
      typeof (parsed as RefreshFailureMarker).consecutiveFailures === "number" &&
      typeof (parsed as RefreshFailureMarker).lastError === "string"
    ) {
      return parsed as RefreshFailureMarker
    }
    return null
  } catch {
    return null
  }
}

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
): Promise<"refreshed" | "fresh" | "no-fields" | "backoff" | "failed"> {
  const now = deps.now ?? (() => new Date())
  const [tSettings, userModel, cached] = await Promise.all([
    loadTrendingSettings(storage),
    readUserModel(storage),
    loadBoard(storage),
  ])
  const fields = effectiveTrackedFields(tSettings.fields, userModel.interests)
  if (fields.length === 0 && tSettings.anchors.length === 0) return "no-fields"
  const scopeStale = tSettings.anchors.length > 0 && !anchorsMatchBoard(cached, tSettings.anchors)
  if (!isStale(cached, tSettings.cadence, now()) && !scopeStale) return "fresh"
  const rawMarker = await readFailureMarker(storage)
  const marker =
    rawMarker != null && cached != null && new Date(cached.generatedAt).getTime() > new Date(rawMarker.lastFailureAt).getTime()
      ? null // a successful refresh happened after the recorded failure — marker obsolete
      : rawMarker

  if (marker != null) {
    const elapsedMs = now().getTime() - new Date(marker.lastFailureAt).getTime()
    if (elapsedMs < backoffMs(marker.consecutiveFailures)) return "backoff"
  }

  try {
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
    try {
      await storage.delete(REFRESH_FAILURE_PATH)
    } catch {
      // Tolerate: some storage backends throw deleting an already-missing
      // file (e.g. Node fs ENOENT) — either way there's nothing to clean up.
    }
    return "refreshed"
  } catch (err) {
    const failureMarker: RefreshFailureMarker = {
      lastFailureAt: now().toISOString(),
      consecutiveFailures: (marker?.consecutiveFailures ?? 0) + 1,
      lastError: err instanceof Error ? err.message : String(err),
    }
    try {
      await storage.write(REFRESH_FAILURE_PATH, JSON.stringify(failureMarker, null, 2))
    } catch (writeErr) {
      // Tolerate: a storage backend failing the dashboard write is plausible
      // to also fail this write (e.g. a full disk) — the marker is
      // best-effort bookkeeping, never allowed to turn a handled failure
      // into an unhandled rejection. The status "failed" is returned either
      // way; the next stale-triggered call simply won't see a backoff marker.
      console.warn("maybeAutoRefreshTrending: failed to write failure marker", writeErr)
    }
    return "failed"
  }
}
