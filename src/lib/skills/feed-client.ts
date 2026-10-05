import { readNdjson } from "../server/ndjson"
import type { FeedResult, FeedStage } from "./feed"

type FeedProgress = (stage: FeedStage | null, startedAt?: number) => void

function progressListener(onStage?: FeedProgress) {
  return (event: { type?: string; [key: string]: unknown }) => {
    if (event.type === "progress" && (event.stage === null || typeof event.stage === "string")) {
      onStage?.(event.stage as FeedStage | null, typeof event.startedAt === "number" ? event.startedAt : undefined)
    }
  }
}

/** Read-only attachment: no active refresh resolves to null, never a new run.
 * Aborting this stream disconnects the browser, not the server-owned pipeline. */
export async function resumeFeedRefresh(
  onStage?: FeedProgress,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
  cachedGeneratedAt?: string,
): Promise<FeedResult | null> {
  const res = await fetchFn("/api/skills/feed/refresh", { method: "GET", cache: "no-store", signal,
    ...(cachedGeneratedAt === undefined ? {} : { headers: { "x-feed-generated-at": cachedGeneratedAt } }),
  })
  if (!res.ok) throw new Error(`Could not reconnect to the feed refresh (${res.status}).`)
  return readNdjson(res, progressListener(onStage)) as Promise<FeedResult | null>
}

/**
 * Browser-side callers for the feed + consolidation skill routes (M11 Task 6).
 * FeedRefreshBar used to build the orchestrators' deps itself (loadSettings +
 * a `SearchFn` implementation + runFeed/runConsolidation) — it now just POSTs to these
 * routes, which own settings/searchFn/LLM keys entirely server-side.
 *
 * Imports `readNdjson` from `../server/ndjson` (a truly isomorphic module with
 * no Node-only dependency) rather than re-exported from `../server/skill-route`,
 * which also exports `jsonSkillRoute`/`ndjsonSkillRoute` and therefore imports
 * `getServerVault` -> `NodeFsVaultStorage` (node:fs/promises) at module scope.
 * Turbopack does not tree-shake that out of a client bundle even when only
 * `readNdjson` is used — see `../server/ndjson.ts`'s header comment and
 * `../trending/client.ts`, which this file mirrors exactly.
 */

/**
 * POST /api/skills/feed/refresh with an empty body; streams NDJSON progress
 * (`onStage` fires with each funnel stage as it starts: "strategy" ->
 * "retrieval" -> "rank" -> "rerank") and resolves with the finished FeedResult.
 */
export async function refreshFeed(
  onStage?: FeedProgress,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<FeedResult> {
  const res = await fetchFn("/api/skills/feed/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    signal,
  })
  return readNdjson(res, progressListener(onStage)) as Promise<FeedResult>
}

export interface ConsolidationRunResult {
  status: "skipped" | "unchanged" | "applied"
  changesetId?: string
  costUsd?: number | null
  runId?: string
}

/**
 * POST /api/skills/consolidate with an empty body; resolves with the server's
 * consolidation outcome. The route self-gates on due-ness, so it's safe to call
 * on every refresh — a not-due call resolves to `{status: "skipped"}` at zero
 * cost rather than needing a client-side `consolidationDue` check first.
 */
export async function consolidate(fetchFn: typeof fetch = fetch): Promise<ConsolidationRunResult> {
  const res = await fetchFn("/api/skills/consolidate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    let message = `consolidation failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* non-JSON body; fall back to the generic status message */
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { result: ConsolidationRunResult }
  return body.result
}
