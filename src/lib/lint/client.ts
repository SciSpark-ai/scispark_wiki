import { readNdjson } from "../server/ndjson"
import type { LintFinding, LintFixOutcome } from "./types"

/**
 * Browser-side callers for the lint skill routes (M12 Task 9), mirroring
 * src/lib/trending/client.ts and src/lib/spark/client.ts exactly: the
 * browser never builds settings/providerOverride/searchFn itself, it just
 * POSTs to the server routes, which own the vault + LLM keys entirely.
 *
 * Imports `readNdjson` from `../server/ndjson` (a truly isomorphic module
 * with no Node-only dependency), NOT re-exported from `../server/skill-route`
 * — that module also exports `jsonSkillRoute`/`ndjsonSkillRoute` and
 * therefore imports `getServerVault` -> `NodeFsVaultStorage`
 * (node:fs/promises) at module scope, which Turbopack will not tree-shake
 * out of a client bundle even when only `readNdjson` is used. See
 * `../server/ndjson.ts`'s header comment.
 */

export interface LintDeterministicRemoteResult {
  findings: LintFinding[]
  reviewIds: string[]
}

export interface LintLlmRemoteResult extends LintDeterministicRemoteResult {
  costUsd: number
}

export interface LintPairProgress {
  index: number
  total: number
  pair: { a: string; b: string }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}

/**
 * POST /api/skills/lint with `{mode: "deterministic"}`; resolves with
 * `{findings, reviewIds}`, same shape as a direct `runLintDeterministic`
 * call.
 */
export async function runLintDeterministicRemote(
  fetchFn: typeof fetch = fetch,
): Promise<LintDeterministicRemoteResult> {
  const res = await fetchFn("/api/skills/lint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "deterministic" }),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `lint (deterministic) failed (${res.status})`))
  }
  const body = (await res.json()) as { result: LintDeterministicRemoteResult }
  return body.result
}

/**
 * POST /api/skills/lint with `{mode: "llm"}`; streams NDJSON progress
 * (`onPair` fires once per candidate pair, before that pair's judge call
 * runs — mirrors `runLintLlm`'s `onProgress`) and resolves with
 * `{findings, reviewIds, costUsd}`. The response is always HTTP 200 (the
 * ndjsonSkillRoute contract) — a skill failure surfaces as a terminal NDJSON
 * error line, which `readNdjson` turns into a rejected promise here, same as
 * a thrown error from a direct `runLintLlm` call.
 */
export async function runLintLlmRemote(
  onPair?: (progress: LintPairProgress) => void,
  fetchFn: typeof fetch = fetch,
): Promise<LintLlmRemoteResult> {
  const res = await fetchFn("/api/skills/lint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "llm" }),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && typeof event.index === "number" && typeof event.total === "number") {
      onPair?.({ index: event.index, total: event.total, pair: event.pair as { a: string; b: string } })
    }
  }) as Promise<LintLlmRemoteResult>
}

/**
 * POST /api/skills/lint/estimate with `{}`; resolves with the static
 * `costUsd` estimate shown in the deep-lint confirm dialog.
 */
export async function estimateLintCost(fetchFn: typeof fetch = fetch): Promise<number> {
  const res = await fetchFn("/api/skills/lint/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `lint estimate failed (${res.status})`))
  }
  const body = (await res.json()) as { result: { costUsd: number } }
  return body.result.costUsd
}

/**
 * POST /api/skills/lint/fix with `{reviewId}`; resolves with
 * `{changesetId, outcome}`, same shape as a direct `applyLintFix` call.
 * `outcome` ("applied" | "resolved" | "needs-manual") is what callers should
 * branch on — see `src/lib/lint/run.ts#applyLintFix`'s comment for why a bare
 * changesetId can't tell "safe to dismiss" apart from "still needs a human".
 */
export async function applyLintFixRemote(
  reviewId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ changesetId: string; outcome: LintFixOutcome }> {
  const res = await fetchFn("/api/skills/lint/fix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewId }),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `lint fix failed (${res.status})`))
  }
  const body = (await res.json()) as { result: { changesetId: string; outcome: LintFixOutcome } }
  return body.result
}
