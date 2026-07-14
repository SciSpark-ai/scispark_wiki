import { readNdjson } from "../server/ndjson"
import type { PaperRecord } from "../papers/types"
import type { DigestResult } from "./digest"
import type { IngestOutput } from "./ingest"

/**
 * Browser-side callers for the digest/ingest/undo skill routes (M11 Task 7).
 * `src/app/papers/page.tsx` used to call `generateDigest`/`runSkill(ingestSkill,
 * ...)`/`undoIngest` directly, building its own `acquireFullText`/settings/
 * highlights deps client-side — it now just calls these three functions,
 * which POST to the server and mirror the page's prior call shapes exactly
 * so the diff there is minimal.
 *
 * Imports `readNdjson` from `../server/ndjson` (a truly isomorphic module with
 * no Node-only dependency) rather than re-exported from `../server/skill-route`,
 * which also exports `jsonSkillRoute`/`ndjsonSkillRoute` and therefore imports
 * `getServerVault` -> `NodeFsVaultStorage` (node:fs/promises) at module scope.
 * Turbopack does not tree-shake that out of a client bundle even when only
 * `readNdjson` is used — see `../server/ndjson.ts`'s header comment and
 * `../skills/feed-client.ts`, which this file mirrors.
 */

export interface DigestRemoteResult {
  digest: DigestResult
  fromCache: boolean
  costUsd?: number
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}

/** POST /api/skills/digest with `{paper}`; resolves with `{digest, fromCache, costUsd}`. */
export async function generateDigestRemote(
  paper: PaperRecord,
  fetchFn: typeof fetch = fetch,
): Promise<DigestRemoteResult> {
  const res = await fetchFn("/api/skills/digest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paper }),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `digest failed (${res.status})`))
  }
  const body = (await res.json()) as { result: DigestRemoteResult }
  return body.result
}

export type IngestPhase = "acquiring" | "snapshotting" | "digesting" | "ingesting"

export interface IngestRemoteResult {
  output: IngestOutput
  costUsd: number
}

/**
 * POST /api/skills/ingest with `{paper}`; streams NDJSON progress (`onPhase`
 * fires with each phase as it starts: "acquiring" -> "snapshotting" (only
 * when acquisition found HTML) -> "digesting" -> "ingesting") and resolves
 * with `{output, costUsd}`. A terminal NDJSON error line (skill run failure)
 * rejects the returned promise, same as a thrown error from the old direct
 * `runSkill` call.
 */
export async function ingestRemote(
  paper: PaperRecord,
  onPhase?: (phase: IngestPhase) => void,
  fetchFn: typeof fetch = fetch,
): Promise<IngestRemoteResult> {
  const res = await fetchFn("/api/skills/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paper }),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && typeof event.phase === "string") onPhase?.(event.phase as IngestPhase)
  }) as Promise<IngestRemoteResult>
}

/** POST /api/skills/ingest/undo with `{changesetId}`; throws on failure, same as the old direct `undoIngest` call. */
export async function undoIngestRemote(changesetId: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn("/api/skills/ingest/undo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changesetId }),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `undo failed (${res.status})`))
  }
}
