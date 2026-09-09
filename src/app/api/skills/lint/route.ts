import { jsonSkillRoute, ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { runLintDeterministic, runLintLlm } from "@/lib/lint/run"
import type { LintFinding } from "@/lib/lint/types"
import { withLedger } from "@/lib/runs/ledger"

interface LintRouteInput {
  mode: "deterministic" | "llm"
}

export interface LintDeterministicRouteResult {
  findings: LintFinding[]
  reviewIds: string[]
}

export interface LintLlmRouteResult extends LintDeterministicRouteResult {
  costUsd: number | null
}

/**
 * "deterministic" sub-handler: single JSON result `{findings, reviewIds}`
 * (jsonSkillRoute). Needs no settings/provider — the deterministic checks
 * (src/lib/lint/checks.ts) are pure vault-bundle analysis, no LLM call.
 */
const deterministicHandler = jsonSkillRoute<LintRouteInput, LintDeterministicRouteResult>(async (_input, vault) => {
  return withLedger(vault, { orchestrator: "lint-deterministic", trigger: "user" }, async () => {
    const result = await runLintDeterministic(vault)
    return { result, status: "ok", meta: { findingCount: result.findings.length } }
  })
})

/**
 * "llm" sub-handler: NDJSON progress stream terminating in the result
 * payload `{findings, reviewIds, costUsd}` (ndjsonSkillRoute). Builds
 * settings/providerOverride server-side exactly like the trending routes,
 * but — unlike trending/feed — needs no `searchFn`: lint reasons entirely
 * over the existing vault bundle (lintScreenSkill/lintJudgeSkill), never
 * fetching fresh papers.
 */
const llmHandler = ndjsonSkillRoute<LintRouteInput>(async (_input, vault, emit) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()

  return withLedger(vault, { orchestrator: "lint-llm", trigger: "user" }, async () => {
    const result = await runLintLlm(vault, {
      settings,
      providerOverride: overrides.providerOverride,
      onProgress: (info) => emit({ type: "progress", index: info.index, total: info.total, pair: info.pair }),
    })
    return { result, status: "ok", costUsd: result.costUsd, meta: { findingCount: result.findings.length } }
  })
})

/**
 * POST /api/skills/lint — body `{mode: "deterministic" | "llm"}`.
 * "deterministic" -> JSON `{result: {findings, reviewIds}}`.
 * "llm" -> NDJSON: one `{type:"progress", index, total, pair}` line per
 * candidate pair (runLintLlm's onProgress, fired before that pair's judge
 * call), terminating in `{type:"result", payload: {findings, reviewIds,
 * costUsd}}`.
 *
 * Both `jsonSkillRoute` and `ndjsonSkillRoute` call `req.json()` themselves,
 * and a `Request` body can only be consumed once — so this outer handler
 * reads the raw text itself just to branch on `mode`, then forwards a
 * freshly-constructed `Request` carrying that same text to whichever
 * sub-handler applies. If the text isn't valid JSON (or has no recognized
 * `mode`), it still falls through to `deterministicHandler`, which will hit
 * the same parse failure and report it via its normal 500 `{error}` path —
 * so a malformed body fails exactly once, in one consistent shape, rather
 * than being special-cased here.
 */
export async function POST(req: Request): Promise<Response> {
  const text = await req.text()
  let mode: string | undefined
  try {
    mode = (JSON.parse(text) as Partial<LintRouteInput>).mode
  } catch {
    mode = undefined
  }
  const forwarded = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  })
  return mode === "llm" ? llmHandler(forwarded) : deterministicHandler(forwarded)
}
