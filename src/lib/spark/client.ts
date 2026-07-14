import { readNdjson } from "../server/ndjson"
import type { Seed, QuickSparkResult } from "./quick"
import type { DeepSparkResult } from "./deep"

/**
 * Browser-side callers for the spark quick/seed/deep/estimate skill routes
 * (M11 Task 8). `SparkPanel` used to build the orchestrators' deps itself
 * (`getOpenVault` + `loadSettings` + `browserSearchFn` + `runQuickSpark`/
 * `saveSeed`/`runDeepSpark`/`estimateDeepSparkCost`) — it now just POSTs to
 * these routes, which own the vault/settings/searchFn/LLM keys entirely
 * server-side, mirroring each function's prior call shape exactly so the
 * component diff stays minimal.
 *
 * Imports `readNdjson` from `../server/ndjson` (a truly isomorphic module with
 * no Node-only dependency) rather than re-exported from `../server/skill-route`,
 * which also exports `jsonSkillRoute`/`ndjsonSkillRoute` and therefore imports
 * `getServerVault` -> `NodeFsVaultStorage` (node:fs/promises) at module scope.
 * Turbopack does not tree-shake that out of a client bundle even when only
 * `readNdjson` is used — see `../server/ndjson.ts`'s header comment and
 * `../skills/ingest-client.ts`/`../skills/feed-client.ts`, which this file
 * mirrors. The `Seed`/`QuickSparkResult`/`DeepSparkResult` type-only imports
 * from `./quick`/`./deep` are safe despite those modules pulling in
 * server-only deps (vault storage, skill runner) — `import type` is erased at
 * compile time, so none of that runtime code reaches the client bundle.
 */

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}

/**
 * POST /api/skills/spark/quick with `{direction, clusterPageIds?}`; resolves
 * with `{seeds, costUsd, runId}`, same as the old direct `runQuickSpark` call.
 */
export async function quickSparkRemote(
  opts: { direction: string; clusterPageIds?: string[] },
  fetchFn: typeof fetch = fetch,
): Promise<QuickSparkResult> {
  const res = await fetchFn("/api/skills/spark/quick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `spark quick failed (${res.status})`))
  }
  const body = (await res.json()) as { result: QuickSparkResult }
  return body.result
}

export interface SaveSeedRemoteResult {
  changesetId: string
  path: string
}

/**
 * POST /api/skills/spark/seed with `{seed}`; resolves with `{changesetId,
 * path}`, same as the old direct `saveSeed` call.
 */
export async function saveSeedRemote(seed: Seed, fetchFn: typeof fetch = fetch): Promise<SaveSeedRemoteResult> {
  const res = await fetchFn("/api/skills/spark/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed }),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `spark seed save failed (${res.status})`))
  }
  const body = (await res.json()) as { result: SaveSeedRemoteResult }
  return body.result
}

export interface DeepSparkRemoteInput {
  direction: string
  clusterPageIds?: string[]
  seedPageId?: string
}

/**
 * POST /api/skills/spark/deep with `{direction, clusterPageIds?, seedPageId?}`;
 * streams NDJSON progress (`onPhase` fires with each phase as it starts:
 * "grounding" -> "bottleneck" -> "ideation" -> "scoop-check" -> "audit", the
 * last three re-fired once on the single internal abandon-retry) and resolves
 * with the full `DeepSparkResult`, same as the old direct `runDeepSpark` call.
 * A terminal NDJSON error line (skill run failure) rejects the returned
 * promise, same as a thrown error from the old direct call.
 */
export async function deepSparkRemote(
  input: DeepSparkRemoteInput,
  onPhase?: (phase: string) => void,
  fetchFn: typeof fetch = fetch,
): Promise<DeepSparkResult> {
  const res = await fetchFn("/api/skills/spark/deep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && typeof event.phase === "string") onPhase?.(event.phase)
  }) as Promise<DeepSparkResult>
}

/**
 * POST /api/skills/spark/estimate with `{}`; resolves with the static
 * `costUsd` estimate, same as the old direct `estimateDeepSparkCost()` call.
 */
export async function estimateRemote(fetchFn: typeof fetch = fetch): Promise<number> {
  const res = await fetchFn("/api/skills/spark/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `spark estimate failed (${res.status})`))
  }
  const body = (await res.json()) as { result: EstimateRemoteResult }
  return body.result.costUsd
}

interface EstimateRemoteResult {
  costUsd: number
}
