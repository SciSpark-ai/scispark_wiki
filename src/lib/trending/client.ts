import { readNdjson } from "../server/ndjson"
import type { TrackedField } from "./fields"
import type { TrendingBoard } from "./types"

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
 * POST /api/skills/trending/refresh with the given interest labels; streams
 * NDJSON progress (`onField` fires with each anchor discipline's label as its
 * group-by requests start) and resolves with the finished TrendingBoard.
 */
export async function refreshTrendingDashboard(
  fields: TrackedField[],
  onField?: (discipline: string) => void,
  fetchFn: typeof fetch = fetch,
): Promise<TrendingBoard> {
  const res = await fetchFn("/api/skills/trending/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && typeof event.field === "string") onField?.(event.field)
  }) as Promise<TrendingBoard>
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
