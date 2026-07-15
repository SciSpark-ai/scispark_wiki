import { jsonSkillRoute } from "@/lib/server/skill-route"
import { PRICES } from "@/lib/llm/pricing"
import { DEFAULT_SETTINGS } from "@/lib/llm/settings"

export interface LintEstimateRouteResult {
  costUsd: number
}

// ---------------------------------------------------------------------------
// Static, documented-approximate estimate for the LLM ("deep") lint confirm
// dialog, shown BEFORE a run — mirrors src/lib/spark/deep.ts's
// estimateDeepSparkCost in shape: a flat sum of generous per-call token
// estimates at the DEFAULT tier models' pricing, not the user's actually
// configured models, and not derived from the live vault (the route has no
// cheap way to know the page/candidate-pair count without itself running the
// screen call it's trying to estimate the cost of).
//
// runLintLlm (src/lib/lint/run.ts) makes exactly one fast-tier screen call
// over the whole page list (lintScreenSkill), then up to that skill's
// MAX_PAIRS=20 strong-tier judge calls — one per candidate pair, each
// reading both pages' full bodies (lintJudgeSkill). This estimate assumes
// the screen call maxes out its pair budget, which is a worst case for a
// well-organized vault, not the typical case — actual spend is usually well
// below this number. Recalibrate the token constants below if
// lintScreenSkill/lintJudgeSkill's prompts change materially.
// ---------------------------------------------------------------------------

const MAX_JUDGE_PAIRS = 20
const SCREEN_INPUT_TOKENS = 6000
const SCREEN_OUTPUT_TOKENS = 800
const JUDGE_INPUT_TOKENS_PER_PAIR = 1600
const JUDGE_OUTPUT_TOKENS_PER_PAIR = 200

function callCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model]
  if (!price) return 0
  return (inputTokens / 1e6) * price.inPerM + (outputTokens / 1e6) * price.outPerM
}

function estimateLintLlmCost(): number {
  const fastModel = DEFAULT_SETTINGS.tierModels.fast.model
  const strongModel = DEFAULT_SETTINGS.tierModels.strong.model
  const screenCost = callCost(fastModel, SCREEN_INPUT_TOKENS, SCREEN_OUTPUT_TOKENS)
  const judgeCost = callCost(strongModel, JUDGE_INPUT_TOKENS_PER_PAIR, JUDGE_OUTPUT_TOKENS_PER_PAIR) * MAX_JUDGE_PAIRS
  return screenCost + judgeCost
}

/**
 * POST /api/skills/lint/estimate — body `{}`, JSON result `{costUsd}`: the
 * static worst-case-ish upfront estimate shown before an LLM lint run (see
 * the module comment above for what it assumes). No LLM call and no vault
 * content is actually needed to compute it, but the route still goes
 * through `jsonSkillRoute` (and therefore `getServerVault()`) for the same
 * request/response contract as every other skill route.
 */
export const POST = jsonSkillRoute<Record<string, never>, LintEstimateRouteResult>(async () => {
  return { costUsd: estimateLintLlmCost() }
})
