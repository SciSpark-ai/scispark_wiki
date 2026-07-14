import type { IdeaCandidate } from "./ideation"
import type { ScoopResult } from "./scoop"
import type { GroundingPaper, SparkGrounding } from "./grounding"
import type { IdeaStatus } from "./idea-page"
import type { AuditResult } from "./audit"

// ---------------------------------------------------------------------------
// assembleIdeaBody: composes the idea-page markdown body from every Deep
// Spark phase's output. PURE — no LLM call, no storage (per
// docs/superpowers/plans/2026-07-13-m9-spark.md Task 6 and the Global
// Constraints "blessed storage pattern" — `runDeepSpark`, Task 7, is the
// orchestrator that calls this and then writes the result via
// `buildIdeaPage`/`applyChangeset`).
// ---------------------------------------------------------------------------

export interface AssembledIdea {
  title: string
  body: string
  /** Vault page ids the idea is grounded on (= `grounding.vaultPageIds`), for the idea
   * page's `related[]` frontmatter. */
  groundingPageIds: string[]
  status: IdeaStatus
}

/** Falsification-plan shape shared by `IdeaCandidate.falsification` and
 * `AuditResult.revisedFalsification` — kept local so this module doesn't need to import
 * either schema's zod object type just to name the fields. */
interface FalsificationPlan {
  hypothesis: string
  prediction: string
  killCriterion: string
  experiment: string
}

/** Applies the FALSIFICATION LOCK's resolution rule: when the audit routed "revise" and
 * supplied a rewritten plan, that plan wins (it always carries all four fields — the
 * lock guarantees this at the schema level, see audit.ts); otherwise the candidate's
 * original falsification plan is used unchanged (routing "accept"/"abandon", or a
 * "revise" that — contrary to the schema — arrived with a null plan). */
function resolveFalsification(candidate: IdeaCandidate, audit: AuditResult): FalsificationPlan {
  if (audit.routing === "revise" && audit.revisedFalsification) {
    return audit.revisedFalsification
  }
  return candidate.falsification
}

function renderFalsification(plan: FalsificationPlan): string[] {
  return [
    `- **Hypothesis:** ${plan.hypothesis}`,
    `- **Prediction:** ${plan.prediction}`,
    `- **Kill criterion:** ${plan.killCriterion}`,
    `- **Experiment:** ${plan.experiment}`,
  ]
}

function renderLitReview(papers: GroundingPaper[]): string {
  if (papers.length === 0) return "(no literature retrieved)"
  return papers.map((p) => `- ${p.title}${p.year !== undefined ? ` (${p.year})` : ""}`).join("\n")
}

function renderScoopCheck(scoop: ScoopResult): string[] {
  const lines = [`**Verdict:** ${scoop.verdict}`, "", scoop.reasoning]
  if (scoop.collidingTitles.length > 0) {
    lines.push("", "Colliding work:", ...scoop.collidingTitles.map((t) => `- ${t}`))
  }
  return lines
}

/**
 * Composes the idea-page markdown body: the card (bottleneck → mechanism → novelty →
 * falsification plan, using the audit's rewritten falsification when it revised the
 * candidate — see `resolveFalsification` — else the candidate's original), the scoop
 * verdict + colliding titles, and a mini lit-review over the grounding's fresh papers.
 * `status` is derived: a "scooped" scoop verdict always yields `status:"scooped"`
 * regardless of the audit's routing (a scoop is a scoop even if the audit still
 * accepted/revised the idea on its other merits); otherwise `"sparked"`.
 */
export function assembleIdeaBody(args: {
  candidate: IdeaCandidate
  scoop: ScoopResult
  bottleneck: string
  grounding: SparkGrounding
  audit: AuditResult
}): AssembledIdea {
  const falsification = resolveFalsification(args.candidate, args.audit)
  const status: IdeaStatus = args.scoop.verdict === "scooped" ? "scooped" : "sparked"

  const body =
    [
      `# ${args.candidate.title}`,
      "",
      "## Bottleneck",
      "",
      args.bottleneck,
      "",
      "## Mechanism",
      "",
      args.candidate.mechanism,
      "",
      "## Novelty",
      "",
      args.candidate.noveltyClaim,
      "",
      "## Falsification Plan",
      "",
      ...renderFalsification(falsification),
      "",
      "## Scoop Check",
      "",
      ...renderScoopCheck(args.scoop),
      "",
      "## Related Literature",
      "",
      renderLitReview(args.grounding.freshPapers),
    ].join("\n") + "\n"

  return {
    title: args.candidate.title,
    body,
    groundingPageIds: args.grounding.vaultPageIds,
    status,
  }
}
