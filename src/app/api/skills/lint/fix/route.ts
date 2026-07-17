import { jsonSkillRoute } from "@/lib/server/skill-route"
import { applyLintFix } from "@/lib/lint/run"
import type { LintFixOutcome } from "@/lib/lint/types"

export interface LintFixRouteInput {
  reviewId: string
}

export interface LintFixRouteResult {
  changesetId: string
  outcome: LintFixOutcome
}

/**
 * POST /api/skills/lint/fix — body `{reviewId}`, JSON result
 * `{changesetId, outcome}`: applies a stored lint finding's mechanical fix
 * (src/lib/lint/run.ts#applyLintFix) through the normal undoable-changeset
 * path, except for lintKind "index-drift", which bypasses the changeset
 * machinery entirely and returns the non-persisted sentinel changesetId
 * documented on `applyLintFix` — see that function's own comment. `outcome`
 * ("applied" | "resolved" | "needs-manual") is what the inbox UI actually
 * branches on — see `applyLintFix`'s own comment for why a bare changesetId
 * can't tell "safe to dismiss" apart from "still needs a human". A thrown
 * error (unknown reviewId, review item with no fix) becomes the usual
 * `jsonSkillRoute` 500 `{error}` response.
 */
export const POST = jsonSkillRoute<LintFixRouteInput, LintFixRouteResult>(async ({ reviewId }, vault) => {
  return applyLintFix(vault, reviewId)
})
