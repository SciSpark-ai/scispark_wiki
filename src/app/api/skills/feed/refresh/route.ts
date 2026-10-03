import { readLedger, withLedger } from "@/lib/runs/ledger"
import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { buildProvider, loadSettings, resolveTier, usesLocalEngine } from "@/lib/llm/settings"
import { nodeFeedSearchFn } from "@/lib/papers/node-search"
import { runFeed, type FeedStage } from "@/lib/skills/feed"
import { loadFeed } from "@/lib/skills/feed-cache"
import type { VaultStorage } from "@/lib/vault/storage"
import {
  skillSingleFlightFor,
  type ActiveFeedRefresh,
} from "@/lib/server/skill-singleflight-state"

const assessmentFailure = "AI relevance assessment did not complete. Your previous feed is still shown. Check your AI connection in Settings before retrying."

/** Older route versions recorded degraded replacements as ok. Read only the
 * bounded skill records newer than the retained cache; never rewrite history or
 * expose their raw errors. New records carry cacheUpdated and skip this path. */
async function legacyAssessmentFailed(vault: VaultStorage, after: number, before: number) {
  const paths = (await vault.list(".scispark/runs/")).filter(path => {
    const time = Number(path.match(/\/run-(\d+)-[^/]+\.json$/)?.[1])
    return time > after && time <= before
  }).sort().reverse().slice(0, 40)
  for (const path of paths) {
    try {
      const record = JSON.parse((await vault.read(path)) ?? "null")
      if (record?.skill === "recommendation-assessment" && ["error", "budget_exceeded"].includes(record.status)) return true
    } catch { /* Ignore corrupt diagnostics; leave the saved feed intact. */ }
  }
  return false
}

async function checkModels(settings: Awaited<ReturnType<typeof loadSettings>>) {
  if (!usesLocalEngine(settings)) return
  const overrides = getSkillTestOverrides().providerOverride
  for (const tier of ["strong", "fast"] as const) {
    const provider = overrides?.[tier] ?? buildProvider(settings, tier)
    await provider.preflight?.(resolveTier(settings, tier).model)
  }
}

function broadcast(state: ActiveFeedRefresh, stage: FeedStage): void {
  state.stage = stage
  for (const listener of state.listeners) {
    try {
      listener({ type: "progress", stage, startedAt: state.startedAt })
    } catch {
      // A disconnected stream must not interrupt the shared provider run.
      state.listeners.delete(listener)
    }
  }
}

async function observe(state: ActiveFeedRefresh, emit: (event: object) => void) {
  state.listeners.add(emit)
  emit({ type: "progress", stage: state.stage, startedAt: state.startedAt })
  try {
    return await state.promise
  } finally {
    state.listeners.delete(emit)
  }
}

/** Reconnect to this profile's active run without ever starting provider work.
 * A null result means there is no active run; Home loads the persisted feed.
 * The shared stream helper disconnects only this observer on navigation. */
export const GET = ndjsonSkillRoute<string | null>(async (cachedAt, vault, emit) => {
  const existing = skillSingleFlightFor(vault).feed
  if (existing) return observe(existing, emit)
  // Read-only readiness also explains an unavailable saved model on old runs
  // whose historical ledger predates explicit degraded-outcome recording.
  await checkModels(await loadSettings(vault))
  const cached = await loadFeed(vault)
  const [latest, previous] = (await readLedger(vault, { limit: 200 })).filter(run => run.orchestrator === "feed-refresh")
  if (latest && (!cached || latest.ts >= cached.generatedAt)
    && (latest.status === "failed" || (latest.status === "degraded" && latest.meta?.cacheUpdated === false))) {
    throw new Error(latest.reason ?? "The last refresh did not update your feed. Your previous papers remain available.")
  }
  if (cached && latest?.status === "ok" && latest.meta?.cacheUpdated === undefined
    && await legacyAssessmentFailed(vault, Math.max(Date.parse(cached.generatedAt), previous ? Date.parse(previous.ts) : 0), Date.parse(latest.ts))) {
    throw new Error(assessmentFailure)
  }
  // Completion can fall between Home reading its cache and attaching here.
  // Only return a changed cache, so a normal visit does not overwrite locally
  // filtered (dismissed) cards or replay an old completion notice.
  if (cachedAt !== null) {
    if (cached && cached.generatedAt !== cachedAt) return cached
  }
  return null
}, async (request) => request.headers.get("x-feed-generated-at"))

/**
 * POST /api/skills/feed/refresh — body `{}`, streaming NDJSON progress.
 *
 * The provider pipeline is single-flight per vault: reloading, navigating,
 * or opening another tab while a refresh is running joins that exact promise
 * and receives its current/future stage instead of paying for duplicate work.
 */
export const POST = ndjsonSkillRoute<Record<string, never>>(async (_input, vault, emit) => {
  const skillSingleFlightState = skillSingleFlightFor(vault)
  const existing = skillSingleFlightState.feed
  if (existing) return observe(existing, emit)

  // Start on the next microtask so the active state is visible before any async
  // dependency lookup can yield to a second request.
  const state: ActiveFeedRefresh = {
    startedAt: Date.now(),
    stage: null,
    listeners: new Set([emit]),
    promise: Promise.resolve().then(async () => {
      const overrides = getSkillTestOverrides()
      const result = await withLedger(vault, { orchestrator: "feed-refresh", trigger: "user" }, async () => {
        const settings = await loadSettings(vault)
        await checkModels(settings)
        const result = await runFeed(vault, {
          searchFn: overrides.searchFn ?? nodeFeedSearchFn(vault),
          settings,
          providerOverride: overrides.providerOverride,
          onStage: (stage) => broadcast(state, stage),
        })
        const cached = await loadFeed(vault)
        const cacheUpdated = cached?.generatedAt === result.generatedAt
        const unranked = result.recommendation?.status === "unranked"
        const reason = !cacheUpdated
          ? unranked
            ? assessmentFailure
            : "No new recommendations met the relevance threshold. Your previous feed is still shown."
          : undefined
        const degraded = !cacheUpdated || unranked || result.recommendation?.warnings.some(warning => warning.startsWith("AI search planning"))
          || result.recommendation?.retrieval.some(trace => trace.error)
        return { result: { feed: result, reason }, status: degraded ? "degraded" : "ok", reason, costUsd: result.costUsd,
          meta: { itemCount: result.items.length, generatedAt: result.generatedAt, cacheUpdated } }
      })
      // A rejected replacement must not briefly replace the page with results
      // that disappear on navigation. Report the durable outcome instead.
      if (result.reason) throw new Error(result.reason)
      return result.feed
    }),
  }
  skillSingleFlightState.feed = state

  try {
    return await state.promise
  } finally {
    state.listeners.delete(emit)
    if (skillSingleFlightState.feed === state) skillSingleFlightState.feed = null
  }
})
