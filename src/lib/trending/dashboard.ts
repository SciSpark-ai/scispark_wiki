import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { SearchFn } from "../skills/feed"
import { runSkill } from "../skills/runner"
import { logEvent } from "../events/log"
import type { TrackedField } from "./fields"
import type { Cadence } from "./settings"
import { retrieveFieldCandidates } from "./retrieve"
import { computeFieldMetrics, DEFAULT_WEEKS, type FieldMetrics, type VolumePoint } from "./metrics"
import { buildWeekStarts } from "./weeks"
import { fetchWeeklyVolume, type CountFn, type GroupFn } from "./weekly-volume"
import { trendingSkill, type TopicBriefs } from "../skills/trending"

export interface FieldPanel {
  field: TrackedField
  metrics: FieldMetrics
  survey: TopicBriefs | null
  /**
   * Present iff the qualitative survey failed for this field (the LLM call
   * erred, the run was budget-exceeded, or retrieval/metrics threw). Carries
   * the real reason so the failure is surfaced to the user instead of a silent
   * `survey: null` — a null with no `surveyError` genuinely means "no survey
   * requested/needed", a null WITH one means "we tried and it failed, here's why".
   */
  surveyError?: string
  generatedAt: string
}
export interface TrendingDashboard {
  panels: FieldPanel[]
  generatedAt: string
}

export const DASHBOARD_CACHE_PATH = ".scispark/trending/dashboard.json"

const DAY_MS = 24 * 60 * 60 * 1000
const CADENCE_MS: Record<Cadence, number> = { daily: DAY_MS, weekly: 7 * DAY_MS }

export interface RunTrendingOpts {
  fields: TrackedField[]
  searchFn: SearchFn
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
  onProgress?: (fieldSlug: string) => void
  /** Real per-week OpenAlex work counter; when present, feeds computeFieldMetrics's realWeeklyVolume. Absent → sample-derived weeklyVolume (unchanged). */
  countFn?: CountFn
  /** Real per-week OpenAlex work counter via one group_by request (1 credit/field); tried first, falls back to countFn's per-week path. Only used when countFn is also present (it's the fallback fetchWeeklyVolume needs). */
  groupFn?: GroupFn
}

/**
 * Orchestrates the trending dashboard (blessed pattern): owns retrieval,
 * metrics, and storage so `trendingSkill` (src/lib/skills/trending.ts) stays
 * a pure LLM unit. Per field: retrieveFieldCandidates → computeFieldMetrics
 * (always run, deterministic — a skill failure never loses the numbers) →
 * runSkill(trendingSkill) for the qualitative survey.
 *
 * `at` is captured once per field and passed to BOTH retrieveFieldCandidates
 * and computeFieldMetrics — per metrics.ts's JSDoc, those two calls must
 * share the same `now` or the recent/prior windows silently desynchronize.
 *
 * Concurrency: home's fire-and-forget auto-refresh (`maybeAutoRefreshTrending`)
 * and /trending's own mount-time refresh can both observe a stale/missing
 * cache and fire at once for the same vault. Concurrent calls for the SAME
 * `storage` share one in-flight run — every caller gets the same
 * `TrendingDashboard` promise/object, and the strong-tier skill runs (and the
 * `trending_refresh` event logs) only once, not once per caller. A call made
 * AFTER the shared run has settled starts a fresh run (so the manual Refresh
 * button still works). Note: the shared run uses only the FIRST caller's
 * `opts` (fields/searchFn/now/settings) — a second concurrent caller's opts
 * are ignored. This is safe today because both call sites (home auto-refresh,
 * /trending mount) derive identical effective fields from the same trending
 * settings; if a future caller needs guaranteed-distinct opts honored
 * concurrently, it must key the in-flight map on more than just `storage`.
 */
const inFlight = new WeakMap<VaultStorage, Promise<TrendingDashboard>>()

export async function runTrendingDashboard(storage: VaultStorage, opts: RunTrendingOpts): Promise<TrendingDashboard> {
  const existing = inFlight.get(storage)
  if (existing) return existing

  const run = runTrendingDashboardUncached(storage, opts).finally(() => {
    inFlight.delete(storage)
  })
  inFlight.set(storage, run)
  return run
}

async function runTrendingDashboardUncached(storage: VaultStorage, opts: RunTrendingOpts): Promise<TrendingDashboard> {
  const now = opts.now ?? (() => new Date())
  const generatedAt = now().toISOString()
  const panels: FieldPanel[] = []
  let costUsd = 0

  for (const field of opts.fields) {
    opts.onProgress?.(field.slug)
    try {
      const at = now()
      const candidates = await retrieveFieldCandidates(opts.searchFn, field, { now: at })

      // Real per-week volume, when a countFn is supplied. `weekStarts` is
      // built from the SAME `at` passed to computeFieldMetrics below, per
      // this function's window-sync requirement. fetchWeeklyVolume already
      // returns null on any single week's failure; the outer .catch is a
      // second line of defense so an unexpected countFn throw (outside
      // fetchWeeklyVolume's own try/catch) still degrades to the
      // sample-derived series instead of failing the whole field.
      let realVol: VolumePoint[] | null = null
      if (opts.countFn) {
        const weekStarts = buildWeekStarts(at, DEFAULT_WEEKS)
        realVol = await fetchWeeklyVolume(opts.countFn, field.label, weekStarts, opts.groupFn).catch(() => null)
      }
      const metrics = computeFieldMetrics(candidates, { now: at, realWeeklyVolume: realVol ?? undefined })

      let survey: TopicBriefs | null = null
      let surveyError: string | undefined
      // Minimal adaptation to the topic-brief skill's new input shape (no
      // counts/percentages/dates — see src/lib/skills/trending.ts): treats
      // the whole field as a single "topic" keyed by its slug, backed by the
      // titles of its most recent candidate papers. Task 7 replaces this with
      // the real per-topic leaderboard (topics.ts's RankedTopic list) joined
      // back onto the LLM's briefs by `key`.
      const run = await runSkill({
        skill: trendingSkill,
        input: {
          discipline: field.label,
          topics: [
            {
              key: field.slug,
              label: field.label,
              paperTitles: candidates.recent.map((p) => p.title).filter((t): t is string => Boolean(t)),
            },
          ],
        },
        storage,
        settings: opts.settings,
        providerOverride: opts.providerOverride,
        now: opts.now,
      })
      if (run.status === "ok" && run.output !== undefined) {
        survey = run.output
        costUsd += run.costUsd
      } else {
        // The survey failed. Record WHY (never a silent null) and still count
        // whatever the failed run spent — a structured-output call that erred
        // after burning provider tokens is metered by the harness, so its cost
        // belongs in this refresh's event just like a successful one's.
        surveyError = run.error ?? `trending skill finished with status "${run.status}"`
        costUsd += run.costUsd
      }

      panels.push({ field, metrics, survey, surveyError, generatedAt })
    } catch (err) {
      // Outer safety net for anything unexpected thrown by retrieval or metrics
      // computation (the skill-failure path above is handled separately and
      // never throws). Per the spec's error-handling section, a per-field
      // failure degrades that panel — it must never fail the whole dashboard,
      // which would lose every other field's panel, the cache write, and the
      // event log. `generatedAt` (captured once above, shared by all panels)
      // stands in for `now()` here since the failure may have originated in
      // `now()` itself.
      panels.push({
        field,
        metrics: computeFieldMetrics({ recent: [], movers: [] }, { now: new Date(generatedAt) }),
        survey: null,
        surveyError: err instanceof Error ? err.message : String(err),
        generatedAt,
      })
    }
  }

  const dashboard: TrendingDashboard = { panels, generatedAt }
  await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify(dashboard, null, 2))
  await logEvent(storage, { type: "trending_refresh", fieldCount: opts.fields.length, costUsd }, now)
  return dashboard
}

export async function loadDashboard(storage: VaultStorage): Promise<TrendingDashboard | null> {
  const raw = await storage.read(DASHBOARD_CACHE_PATH)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && Array.isArray(parsed.panels) && typeof parsed.generatedAt === "string"
      ? (parsed as TrendingDashboard)
      : null
  } catch {
    return null
  }
}

export function isStale(dashboard: TrendingDashboard | null, cadence: Cadence, now: Date): boolean {
  if (dashboard == null) return true
  const gen = new Date(dashboard.generatedAt).getTime()
  if (Number.isNaN(gen)) return true
  return now.getTime() - gen >= CADENCE_MS[cadence]
}

/**
 * True iff `dashboard` is non-null and the SET of its panels' field slugs
 * equals the set of `fields`' slugs (order-insensitive). Used to detect a
 * settings-change path (e.g. profile save) that swapped tracked fields
 * without a corresponding refresh — a cache can be time-fresh but field-stale.
 */
export function fieldsMatchDashboard(dashboard: TrendingDashboard | null, fields: TrackedField[]): boolean {
  if (dashboard == null) return false
  const dashboardSlugs = new Set(dashboard.panels.map((p) => p.field.slug))
  const fieldSlugs = new Set(fields.map((f) => f.slug))
  if (dashboardSlugs.size !== fieldSlugs.size) return false
  for (const slug of fieldSlugs) {
    if (!dashboardSlugs.has(slug)) return false
  }
  return true
}
