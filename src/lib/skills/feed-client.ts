import { readNdjson } from "../server/ndjson"
import type { FeedResult, FeedStage } from "./feed"

/**
 * Browser-side callers for the feed + consolidation skill routes (M11 Task 6).
 * FeedRefreshBar used to build the orchestrators' deps itself (loadSettings +
 * browserSearchFn + runFeed/runConsolidation) — it now just POSTs to these
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
  onStage?: (stage: FeedStage) => void,
  fetchFn: typeof fetch = fetch,
): Promise<FeedResult> {
  const res = await fetchFn("/api/skills/feed/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && typeof event.stage === "string") onStage?.(event.stage as FeedStage)
  }) as Promise<FeedResult>
}

export interface ConsolidationRunResult {
  status: "skipped" | "unchanged" | "applied"
  changesetId?: string
  costUsd?: number
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
