import { readNdjson } from "../server/ndjson"
import type { TrackedField } from "./fields"
import type { TrendingDashboard } from "./dashboard"

/**
 * Browser-side callers for the trending skill routes (M11 Task 5). Both
 * pages that used to build the orchestrator's deps themselves
 * (loadSettings + a `SearchFn` implementation + runTrendingDashboard /
 * maybeAutoRefreshTrending) now just POST to the server, which owns
 * settings/searchFn/LLM keys entirely — the browser never sees them.
 *
 * This file imports `readNdjson` from `../server/ndjson` (a truly isomorphic
 * module with no Node-only dependency) rather than re-exported from
 * `../server/skill-route`, which also exports `jsonSkillRoute`/
 * `ndjsonSkillRoute` and therefore imports `getServerVault` →
 * `NodeFsVaultStorage` (node:fs/promises) at module scope. Turbopack does not
 * tree-shake that out of a client bundle even when only `readNdjson` is used
 * — see `../server/ndjson.ts`'s header comment.
 */

/**
 * POST /api/skills/trending/refresh with the given fields; streams NDJSON
 * progress (`onField` fires with each field's slug as its panel starts) and
 * resolves with the finished TrendingDashboard.
 */
export async function refreshTrendingDashboard(
  fields: TrackedField[],
  onField?: (fieldSlug: string) => void,
  fetchFn: typeof fetch = fetch,
): Promise<TrendingDashboard> {
  const res = await fetchFn("/api/skills/trending/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && typeof event.field === "string") onField?.(event.field)
  }) as Promise<TrendingDashboard>
}

/**
 * POST /api/skills/trending/auto-refresh with an empty body; resolves with
 * the server's refresh outcome.
 */
export async function autoRefreshTrending(
  fetchFn: typeof fetch = fetch,
): Promise<"refreshed" | "fresh" | "no-fields"> {
  const res = await fetchFn("/api/skills/trending/auto-refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    let message = `trending auto-refresh failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* non-JSON body; fall back to the generic status message */
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { result: "refreshed" | "fresh" | "no-fields" }
  return body.result
}
