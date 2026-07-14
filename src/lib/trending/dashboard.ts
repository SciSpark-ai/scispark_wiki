import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { SearchFn } from "../skills/feed"
import { runSkill } from "../skills/runner"
import { logEvent } from "../events/log"
import type { TrackedField } from "./fields"
import type { Cadence } from "./settings"
import { retrieveFieldCandidates } from "./retrieve"
import { computeFieldMetrics, type FieldMetrics } from "./metrics"
import { trendingSkill, type TrendingSurvey } from "../skills/trending"

export interface FieldPanel {
  field: TrackedField
  metrics: FieldMetrics
  survey: TrendingSurvey | null
  error?: string
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
 */
export async function runTrendingDashboard(storage: VaultStorage, opts: RunTrendingOpts): Promise<TrendingDashboard> {
  const now = opts.now ?? (() => new Date())
  const generatedAt = now().toISOString()
  const panels: FieldPanel[] = []
  let costUsd = 0

  for (const field of opts.fields) {
    opts.onProgress?.(field.slug)
    try {
      const at = now()
      const candidates = await retrieveFieldCandidates(opts.searchFn, field, { now: at })
      const metrics = computeFieldMetrics(candidates, { now: at })

      let survey: TrendingSurvey | null = null
      let error: string | undefined
      const run = await runSkill({
        skill: trendingSkill,
        input: { field, recent: candidates.recent, movers: candidates.movers },
        storage,
        settings: opts.settings,
        providerOverride: opts.providerOverride,
        now: opts.now,
      })
      if (run.status === "ok" && run.output !== undefined) {
        survey = run.output
        costUsd += run.costUsd
      } else {
        error = run.error ?? `trending skill finished with status "${run.status}"`
      }

      panels.push({ field, metrics, survey, error, generatedAt })
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
        error: err instanceof Error ? err.message : String(err),
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
