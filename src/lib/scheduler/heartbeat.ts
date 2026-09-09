import type { VaultStorage } from "../vault/storage"
import type { TopWorksFn, TopicGroupFn } from "../papers/node-search"
import type { CountFn } from "../trending/counts"
import { loadSettings } from "../llm/settings"
import { withLedger, readLedger } from "../runs/ledger"
import { maybeAutoRefreshTrending, REFRESH_FAILURE_PATH } from "../trending/auto-refresh"
import { runConsolidation } from "../skills/consolidation"
import { runLintDeterministic } from "../lint/run"
import { getServerVault } from "../server/vault"
import { nodeTopWorksFn, nodeCountFn, nodeTopicGroupFn, nodeTopicFieldGroupFn } from "../papers/node-search"

// ---------------------------------------------------------------------------
// Scheduler heartbeat (M12 follow-up Task 7): the M11 local-runtime pivot made
// the Next.js server the runtime, so a real server-side setInterval is now a
// legitimate v1 "cron" for the three already-gated background orchestrators
// (trending auto-refresh, memory consolidation, deterministic lint) — the old
// "staleness-refresh instead of cron" framing predates that pivot. Each job
// stays exactly as safe as its user-triggered counterpart: trending/
// consolidation are self-gated (cadence/backoff, >=25-new-events) and lint has
// its own 24h gate here, so a heartbeat tick that fires while nothing is due
// is nearly free.
// ---------------------------------------------------------------------------

/** Best-effort read of the trending failure marker's `lastError`, for the
 * ledger's "failed" reason — copied from
 * src/app/api/skills/trending/auto-refresh/route.ts so the schedule-triggered
 * ledger record carries the same diagnostic as the user-triggered one. */
async function readFailureReason(storage: VaultStorage): Promise<string | undefined> {
  try {
    const raw = await storage.read(REFRESH_FAILURE_PATH)
    if (raw == null) return undefined
    const parsed = JSON.parse(raw) as { lastError?: unknown }
    return typeof parsed.lastError === "string" ? parsed.lastError : undefined
  } catch {
    return undefined
  }
}

/** Test-only overrides for the three job orchestrators. Not part of the
 * binding `HeartbeatDeps` shape used by callers/tests exercising the real
 * jobs — a place for `runHeartbeatTick` unit tests to inject fakes without
 * touching network/LLM/vault-bundle machinery, mirroring the
 * `setSkillTestOverrides` pattern used by the skill routes but as plain
 * constructor-param injection (simpler, sufficient here since only this
 * module's own tests need it). */
export interface HeartbeatJobOverrides {
  maybeAutoRefreshTrending?: typeof maybeAutoRefreshTrending
  runConsolidation?: typeof runConsolidation
  runLintDeterministic?: typeof runLintDeterministic
}

export interface HeartbeatDeps {
  storage: VaultStorage
  topWorksFn: TopWorksFn
  countFn?: CountFn
  topicGroupFn?: TopicGroupFn
  fieldGroupFn?: TopicGroupFn
  now?: () => Date
  /** See `HeartbeatJobOverrides` — test-only, defaults to the real orchestrators. */
  jobs?: HeartbeatJobOverrides
}

const LINT_GATE_MS = 24 * 60 * 60 * 1000
// readLedger defaults to the 50 most recent records. This scans a larger
// window (200) instead, but that number does NOT reliably cover 24h on an
// active vault: the heartbeat alone appends up to 3 records every 15
// minutes (~192/day at the default interval), before counting ingest/enrich/
// spark/manual-lint records sharing the same file. On a genuinely busy
// ledger, 200 can still fall short of 24h of activity, so this gate can fire
// EARLY (running lint sooner than the "real" 24h target) rather than the
// converse (it can never run it LATE due to the scan window, only miss
// seeing an even-older last run and treat it as "absent"). That's an
// acceptable failure mode: lint is free (no LLM call) and idempotent, so an
// occasional early run just means slightly more frequent free lint passes,
// never a correctness or cost problem. If this ever needs to be exact,
// the fix is a dedicated small marker file (mirroring
// src/lib/skills/consolidation.ts's CONSOLIDATION_MARKER) instead of scanning
// the shared ledger.
const LINT_LEDGER_SCAN_LIMIT = 200

// In-flight guard (reviewer finding, post-initial-implementation): a tick can
// run long — the LLM call timeout is 120s, arXiv/OpenAlex retries with
// backoff, and a multi-field trending survey chains several of those. A slow
// tick can still be running when the NEXT 15-min interval firing would
// otherwise start a second, overlapping tick; both would read "due" state
// (cadence/backoff/event-count gates) before either had written results,
// causing a real double-spend of LLM cost. This mirrors the double-spend risk
// Deep Spark already guards against (src/lib/spark/deep.ts's serialized,
// no-double-spend run). The guard SKIPS an overlapping call outright rather
// than queuing it — a fast-following tick has nothing new to do anyway, since
// it would just re-evaluate the same gates the in-progress tick is already
// evaluating. A plain module-scope variable (not globalThis) is sufficient:
// unlike the stop-function singleton below — which must survive module
// re-evaluation under dev HMR so two `startHeartbeat()` calls from different
// module instances still share one interval — this guard only ever needs to
// coordinate calls within the SAME module instance that owns the actual
// running interval (the globalThis singleton already ensures there is only
// ever one such instance's interval actually firing at a time).
let tickInFlight: Promise<void> | null = null

/**
 * One heartbeat tick: runs the trending auto-refresh, memory-consolidation,
 * and deterministic-lint jobs in sequence, each wrapped in `withLedger` with
 * `trigger: "schedule"` so a scheduled run leaves the same kind of audit trail
 * a user-triggered run does (status mapping copied from the corresponding
 * `/api/skills/*` route). Never throws: each job lives in its own try/catch.
 * `withLedger` itself rethrows after recording a "failed" status on a job
 * throw, so the per-job catch here exists specifically to swallow that
 * rethrow — without it, job 2 throwing would stop job 3 from ever running.
 *
 * Guarded against overlap: if a previous call's work is still in flight, this
 * returns immediately WITHOUT running any job (see `tickInFlight` above) —
 * skip, not queue.
 */
export async function runHeartbeatTick(deps: HeartbeatDeps): Promise<void> {
  if (tickInFlight) return
  const run = runHeartbeatTickInner(deps)
  tickInFlight = run
  try {
    await run
  } finally {
    tickInFlight = null
  }
}

async function runHeartbeatTickInner(deps: HeartbeatDeps): Promise<void> {
  const now = deps.now ?? (() => new Date())
  const jobs: Required<HeartbeatJobOverrides> = {
    maybeAutoRefreshTrending: deps.jobs?.maybeAutoRefreshTrending ?? maybeAutoRefreshTrending,
    runConsolidation: deps.jobs?.runConsolidation ?? runConsolidation,
    runLintDeterministic: deps.jobs?.runLintDeterministic ?? runLintDeterministic,
  }

  // Job 1: trending auto-refresh. Status mapping mirrors
  // src/app/api/skills/trending/auto-refresh/route.ts exactly, trigger "schedule".
  try {
    await withLedger(deps.storage, { orchestrator: "trending-refresh", trigger: "schedule", now }, async () => {
      const settings = await loadSettings(deps.storage)
      const result = await jobs.maybeAutoRefreshTrending(deps.storage, {
        topWorksFn: deps.topWorksFn,
        countFn: deps.countFn ?? nodeCountFn(),
        topicGroupFn: deps.topicGroupFn ?? nodeTopicGroupFn(),
        fieldGroupFn: deps.fieldGroupFn ?? nodeTopicFieldGroupFn(),
        settings,
        now,
      })
      if (result === "refreshed") return { result, status: "ok" as const }
      if (result === "failed") {
        return { result, status: "failed" as const, reason: await readFailureReason(deps.storage) }
      }
      // "fresh" | "no-fields" | "backoff"
      return { result, status: "skipped" as const, reason: result }
    })
  } catch {
    // Already recorded as "failed" by withLedger above — swallow so job 2 still runs.
  }

  // Job 2: memory consolidation. Self-gated on >=25 new events since the last
  // run; status mapping mirrors src/app/api/skills/consolidate/route.ts.
  try {
    await withLedger(deps.storage, { orchestrator: "consolidation", trigger: "schedule", now }, async () => {
      const settings = await loadSettings(deps.storage)
      const result = await jobs.runConsolidation(deps.storage, { settings, now })
      if (result.status === "skipped") {
        return { result, status: "skipped" as const, costUsd: result.costUsd }
      }
      // "unchanged" | "applied"
      return { result, status: "ok" as const, reason: result.status, costUsd: result.costUsd }
    })
  } catch {
    // Already recorded as "failed" by withLedger above — swallow so job 3 still runs.
  }

  // Job 3: deterministic lint (free, no LLM call). Unlike trending/consolidation
  // this orchestrator has no due-ness gate of its own, so the heartbeat gates it
  // here: only run when the last successful "lint-deterministic" ledger record (from ANY
  // trigger — a manual "Lint vault" click resets the clock same as a scheduled
  // run) is more than 24h old, or there is none yet. When it isn't due, this
  // deliberately records NOTHING — an hourly "skipped" row for a job that has
  // nothing to do would spam the ledger for no benefit (contrast trending/
  // consolidation, whose own "skipped" statuses are still meaningful signal
  // about cadence/backoff/event-count).
  try {
    const records = await readLedger(deps.storage, { limit: LINT_LEDGER_SCAN_LIMIT })
    // A failed attempt remains due and can retry on the next 15-minute tick.
    const lastLint = records.find((r) => r.orchestrator === "lint-deterministic" && r.status === "ok")
    const due = lastLint === undefined || now().getTime() - new Date(lastLint.ts).getTime() > LINT_GATE_MS
    if (due) {
      await withLedger(deps.storage, { orchestrator: "lint-deterministic", trigger: "schedule", now }, async () => {
        const result = await jobs.runLintDeterministic(deps.storage, { now })
        return { result, status: "ok" as const, meta: { findingCount: result.findings.length } }
      })
    }
  } catch {
    // Already recorded as "failed" by withLedger above (if the throw happened
    // inside it) — either way, swallow so a future tick isn't affected.
  }
}

const HEARTBEAT_SYMBOL = Symbol.for("scispark.heartbeat")
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000
const INITIAL_DELAY_MS = 60 * 1000

/** Runs one tick with freshly-built server-side deps, tolerating any failure
 * in the dep construction itself (e.g. vault scaffolding or env misconfig) so
 * a bad tick can never crash the interval or the process. */
async function tick(): Promise<void> {
  try {
    const storage = await getServerVault()
    await runHeartbeatTick({
      storage,
      topWorksFn: nodeTopWorksFn(),
      countFn: nodeCountFn(),
      topicGroupFn: nodeTopicGroupFn(),
      fieldGroupFn: nodeTopicFieldGroupFn(),
    })
  } catch (err) {
    console.warn("[scheduler] heartbeat tick failed", err)
  }
}

/**
 * Starts the server heartbeat: an initial tick after a 60s delay (letting the
 * server finish booting) followed by a recurring tick every `intervalMs`
 * (default 15 min). Returns a stop function that clears both timers.
 *
 * Opt-in: only `SCISPARK_SCHEDULER=on` enables background jobs. The default
 * and `off` return a noop without touching `globalThis` or creating timers.
 * Opening the app therefore cannot silently start paid scheduled work.
 *
 * Singleton: guarded by a `Symbol.for("scispark.heartbeat")` slot on
 * `globalThis` (a *global* symbol registry key, so it survives module
 * re-evaluation) — dev HMR / multiple `register()` calls must not stack up
 * duplicate intervals. A second call returns the SAME stop function as the
 * first; it does not start a second heartbeat.
 */
// A symbol INDEX SIGNATURE (covers any symbol key), not a computed property
// referring to one specific symbol — `Symbol.for(...)` returns the widened
// `symbol` type, not a `unique symbol`, so it can't appear as a single
// computed property name in a type literal, only as an index signature.
type GlobalWithHeartbeat = typeof globalThis & { [key: symbol]: unknown }

export function startHeartbeat(opts?: { intervalMs?: number }): () => void {
  if (process.env.SCISPARK_SCHEDULER !== "on") return () => {}

  const globalWithHeartbeat = globalThis as GlobalWithHeartbeat
  const existing = globalWithHeartbeat[HEARTBEAT_SYMBOL] as (() => void) | undefined
  if (existing) return existing

  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS

  // One boot line so a running heartbeat is observable in the server logs —
  // the smoke check for "is the scheduler alive" reads this, and a silent
  // scheduler is indistinguishable from a never-registered one.
  console.log(
    `[scheduler] heartbeat started (first tick in ${INITIAL_DELAY_MS / 1000}s, then every ${intervalMs / 60000}min; SCISPARK_SCHEDULER=off disables)`,
  )

  const initialTimer = setTimeout(() => {
    void tick()
  }, INITIAL_DELAY_MS)
  initialTimer.unref?.()

  const intervalTimer = setInterval(() => {
    void tick()
  }, intervalMs)
  intervalTimer.unref?.()

  const stop = (): void => {
    clearTimeout(initialTimer)
    clearInterval(intervalTimer)
    delete globalWithHeartbeat[HEARTBEAT_SYMBOL]
  }

  globalWithHeartbeat[HEARTBEAT_SYMBOL] = stop
  return stop
}
