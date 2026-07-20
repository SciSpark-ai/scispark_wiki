import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { SearchFn } from "../skills/feed"
import type { CountFn, GroupFn } from "./weekly-volume"
import { readUserModel } from "../usermodel/pages"
import { effectiveTrackedFields } from "./fields"
import { loadTrendingSettings } from "./settings"
import { loadDashboard, isStale, fieldsMatchDashboard, runTrendingDashboard } from "./dashboard"

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
 * v1 "cron": on app open, refresh the trending dashboard if it is stale for the
 * user's cadence, OR if the cached dashboard's panels are for a different field
 * set than currently tracked (mirrors /trending's own staleness check — see
 * dashboard.ts's fieldsMatchDashboard JSDoc: a cache can be time-fresh but
 * field-stale after a /profile settings change). Fire-and-forget from the home
 * page — never blocks render.
 *
 * Failure backoff (closes a silent re-spend bug): if `runTrendingDashboard`
 * throws before it reaches its own per-field try/catch (e.g. its final cache
 * write), no `generatedAt` lands, so every subsequent visit would otherwise
 * re-trigger a full paid refresh forever. A failure marker
 * (`REFRESH_FAILURE_PATH`) records `lastFailureAt`/`consecutiveFailures`/
 * `lastError`; while `now` is within `backoffMs(consecutiveFailures)` of the
 * marker, this returns "backoff" without spending. The marker is ignored
 * (treated as absent) if it's missing/unparseable, or if the cached
 * dashboard's `generatedAt` is newer than `lastFailureAt` — a successful
 * refresh happened after the recorded failure, so the marker is stale. A
 * success deletes the marker before returning; a failure never rethrows (both
 * call sites are fire-and-forget) — it writes/updates the marker and returns
 * "failed". Manual refresh (the /trending page calling runTrendingDashboard
 * directly) is untouched and never backs off.
 */
export async function maybeAutoRefreshTrending(
  storage: VaultStorage,
  deps: {
    searchFn: SearchFn
    settings: LLMSettings
    now?: () => Date
    providerOverride?: Partial<Record<Tier, LLMProvider>>
    countFn?: CountFn
    groupFn?: GroupFn
  },
): Promise<"refreshed" | "fresh" | "no-fields" | "backoff" | "failed"> {
  const now = deps.now ?? (() => new Date())
  const [tSettings, userModel, cached] = await Promise.all([
    loadTrendingSettings(storage),
    readUserModel(storage),
    loadDashboard(storage),
  ])
  const fields = effectiveTrackedFields(tSettings.fields, userModel.interests)
  if (fields.length === 0) return "no-fields"
  if (!isStale(cached, tSettings.cadence, now()) && fieldsMatchDashboard(cached, fields)) return "fresh"

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
    await runTrendingDashboard(storage, {
      fields,
      searchFn: deps.searchFn,
      countFn: deps.countFn,
      groupFn: deps.groupFn,
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
