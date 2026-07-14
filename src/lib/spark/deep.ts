import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { Changeset, FileChange } from "../vault/types"
import { applyChangeset, makeChangesetId } from "../vault/changesets"
import { runSkill } from "../skills/runner"
import { logEvent } from "../events/log"
import { PRICES } from "../llm/pricing"
import { assembleGrounding, type SearchFn } from "./grounding"
import { bottleneckSkill } from "./bottleneck"
import { ideationSkill, type IdeaCandidate } from "./ideation"
import { runScoopCheck, type ScoopResult } from "./scoop"
import { auditSkill, type AuditResult } from "./audit"
import { assembleIdeaBody } from "./assemble"
import { buildIdeaPage, type IdeaStatus } from "./idea-page"
import { loadPatternCards, patternIndex } from "./pattern-cards"

// ---------------------------------------------------------------------------
// Deep Spark orchestrator: wires the Task 3-6 phase skills into the full
// pipeline — assembleGrounding -> bottleneckSkill -> ideationSkill ->
// runScoopCheck -> auditSkill -> (assemble + write). Pure orchestration, no
// LLM calls of its own (blessed pattern, docs/design/04-agent-harness.md);
// see docs/superpowers/plans/2026-07-13-m9-spark.md Task 7.
// ---------------------------------------------------------------------------

export type DeepSparkOutcome =
  | { kind: "idea"; ideaPageId: string; changesetId: string; status: IdeaStatus }
  | { kind: "do_not_generate"; reason: string }
  | { kind: "abandoned"; reason: string } // audit abandoned after the single internal retry

export interface DeepSparkResult {
  outcome: DeepSparkOutcome
  costUsd: number
  phaseCosts: Record<string, number>
}

export interface DeepSparkArgs {
  storage: VaultStorage
  direction: string
  clusterPageIds?: string[]
  /** When "developing fully" an existing Quick Spark seed -> upgrade that page in place
   * (its path is overwritten; the seed's prior content becomes the changeset's `before`,
   * so reverting the changeset restores the seed). A bare wiki id, no trailing ".md". */
  seedPageId?: string
  searchFn: SearchFn
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  today: string
  now?: () => Date
  /** Progress callback for the UI — fires once per phase entered (and again for each
   * phase re-run by the single internal retry on an "abandon" audit). */
  onPhase?: (phase: string) => void
}

// ---------------------------------------------------------------------------
// estimateDeepSparkCost: a static, documented-approximate upfront estimate for
// the confirm dialog. Real cost varies with how much context assembleGrounding
// pulls in and whether the audit's single internal retry fires — this is a
// rough sum of typical per-phase token counts at the default strong-tier
// model's pricing, NOT a budget guarantee.
// ---------------------------------------------------------------------------

const ESTIMATE_MODEL = "claude-opus-4-8"

/** Rough per-phase input/output token estimates for a single (non-retried) pass,
 * at the default strong-tier model. bottleneck/ideation/audit carry the full
 * grounding context (vault snippets + up to 20 fresh papers + the ~46-card
 * pattern index) on the input side; the two scoop-check calls are lighter. */
const PHASE_TOKEN_ESTIMATES: Record<string, { inputTokens: number; outputTokens: number }> = {
  bottleneck: { inputTokens: 4000, outputTokens: 500 },
  ideation: { inputTokens: 6000, outputTokens: 1200 },
  "scoop-terms": { inputTokens: 2000, outputTokens: 300 },
  "scoop-verdict": { inputTokens: 5000, outputTokens: 600 },
  audit: { inputTokens: 6000, outputTokens: 900 },
}

export async function estimateDeepSparkCost(): Promise<number> {
  const price = PRICES[ESTIMATE_MODEL]
  if (!price) return 0
  let total = 0
  for (const { inputTokens, outputTokens } of Object.values(PHASE_TOKEN_ESTIMATES)) {
    total += (inputTokens / 1e6) * price.inPerM + (outputTokens / 1e6) * price.outPerM
  }
  return total
}

// ---------------------------------------------------------------------------
// Candidate/scoop -> plain-text serialization for the phases that consume
// them as untrusted input strings (`runScoopCheck`'s `candidateText`,
// `auditSkill`'s `candidate`/`scoopVerdict`). Each of those skills fences +
// neutralizes its own string inputs on the way into the prompt (see their
// `fence()` helpers), so this orchestrator does not need to neutralize here.
// ---------------------------------------------------------------------------

function renderCandidateText(candidate: IdeaCandidate): string {
  return [
    `Title: ${candidate.title}`,
    `Mechanism: ${candidate.mechanism}`,
    `Novelty claim: ${candidate.noveltyClaim}`,
    `Pattern ids: ${candidate.patternIds.join(", ")}`,
    "Falsification plan:",
    `  Hypothesis: ${candidate.falsification.hypothesis}`,
    `  Prediction: ${candidate.falsification.prediction}`,
    `  Kill criterion: ${candidate.falsification.killCriterion}`,
    `  Experiment: ${candidate.falsification.experiment}`,
  ].join("\n")
}

function renderScoopVerdictText(scoop: ScoopResult): string {
  const lines = [`Verdict: ${scoop.verdict}`, scoop.reasoning]
  if (scoop.collidingTitles.length > 0) {
    lines.push("Colliding titles:", ...scoop.collidingTitles.map((t) => `- ${t}`))
  }
  return lines.join("\n")
}

/** Concrete reason for an "abandoned" outcome — the failing checks' notes from the
 * SECOND (post-retry) audit, joined; falls back to a generic message on the
 * (schema-permitted but atypical) case where "abandon" carries no failing check. */
function abandonReason(audit: AuditResult): string {
  const failing = audit.checks.filter((c) => !c.passed).map((c) => c.note)
  return failing.length > 0 ? failing.join(" ") : "The audit abandoned this idea after the internal retry."
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface IdeationScoopAudit {
  candidate: IdeaCandidate
  scoop: ScoopResult
  audit: AuditResult
}

export async function runDeepSpark(args: DeepSparkArgs): Promise<DeepSparkResult> {
  const now = args.now ?? (() => new Date())
  const phaseCosts: Record<string, number> = {}
  let costUsd = 0

  function addCost(phase: string, amount: number): void {
    phaseCosts[phase] = (phaseCosts[phase] ?? 0) + amount
    costUsd += amount
  }

  async function logOutcome(outcome: string, ideaPageId?: string): Promise<void> {
    await logEvent(
      args.storage,
      { type: "spark_run", mode: "deep", outcome, ...(ideaPageId ? { ideaPageId } : {}), costUsd },
      now,
    )
  }

  // ---- Phase: grounding (no LLM call) -------------------------------------
  args.onPhase?.("grounding")
  const grounding = await assembleGrounding(args.storage, {
    direction: args.direction,
    clusterPageIds: args.clusterPageIds,
    searchFn: args.searchFn,
  })
  phaseCosts.grounding = phaseCosts.grounding ?? 0

  // ---- Phase: bottleneck ---------------------------------------------------
  args.onPhase?.("bottleneck")
  const bottleneckRun = await runSkill({
    skill: bottleneckSkill,
    input: { direction: args.direction, groundingContext: grounding.contextText },
    storage: args.storage,
    settings: args.settings,
    providerOverride: args.providerOverride,
    now: args.now,
  })
  if (bottleneckRun.status !== "ok" || bottleneckRun.output === undefined) {
    throw new Error(bottleneckRun.error ?? `spark-bottleneck run finished with unexpected status "${bottleneckRun.status}"`)
  }
  addCost("bottleneck", bottleneckRun.costUsd)
  const bottleneck = bottleneckRun.output

  if (bottleneck.routing === "do_not_generate") {
    const outcome: DeepSparkOutcome = { kind: "do_not_generate", reason: bottleneck.refusalReason }
    await logOutcome("do_not_generate")
    return { outcome, costUsd, phaseCosts }
  }

  const patternCatalog = patternIndex(loadPatternCards())

  // ---- Phases: ideation -> scoop-check -> audit, as a retryable unit -------
  async function runIdeationScoopAudit(): Promise<IdeationScoopAudit> {
    args.onPhase?.("ideation")
    const ideationRun = await runSkill({
      skill: ideationSkill,
      input: {
        bottleneck: bottleneck.bottleneck,
        whyItMatters: bottleneck.whyItMatters,
        groundingContext: grounding.contextText,
        patternIndex: patternCatalog,
      },
      storage: args.storage,
      settings: args.settings,
      providerOverride: args.providerOverride,
      now: args.now,
    })
    if (ideationRun.status !== "ok" || ideationRun.output === undefined) {
      throw new Error(ideationRun.error ?? `spark-ideation run finished with unexpected status "${ideationRun.status}"`)
    }
    addCost("ideation", ideationRun.costUsd)
    const candidate = ideationRun.output

    args.onPhase?.("scoop-check")
    const scoop = await runScoopCheck(args.storage, {
      candidateText: renderCandidateText(candidate),
      searchFn: args.searchFn,
      settings: args.settings,
      providerOverride: args.providerOverride,
      now: args.now,
    })
    addCost("scoop-check", scoop.costUsd)

    args.onPhase?.("audit")
    const auditRun = await runSkill({
      skill: auditSkill,
      input: {
        candidate: renderCandidateText(candidate),
        scoopVerdict: renderScoopVerdictText(scoop),
        groundingContext: grounding.contextText,
      },
      storage: args.storage,
      settings: args.settings,
      providerOverride: args.providerOverride,
      now: args.now,
    })
    if (auditRun.status !== "ok" || auditRun.output === undefined) {
      throw new Error(auditRun.error ?? `spark-audit run finished with unexpected status "${auditRun.status}"`)
    }
    addCost("audit", auditRun.costUsd)

    return { candidate, scoop, audit: auditRun.output }
  }

  let attempt = await runIdeationScoopAudit()
  if (attempt.audit.routing === "abandon") {
    // One internal retry (ResearchStudio-style single retry-on-abandon, per the plan).
    attempt = await runIdeationScoopAudit()
    if (attempt.audit.routing === "abandon") {
      const reason = abandonReason(attempt.audit)
      const outcome: DeepSparkOutcome = { kind: "abandoned", reason }
      await logOutcome("abandoned")
      return { outcome, costUsd, phaseCosts }
    }
  }

  // ---- Assemble + write (accept or revise both land here) ------------------
  const assembled = assembleIdeaBody({
    candidate: attempt.candidate,
    scoop: attempt.scoop,
    bottleneck: bottleneck.bottleneck,
    grounding,
    audit: attempt.audit,
  })

  const draft = buildIdeaPage({
    slugSeed: assembled.title,
    title: assembled.title,
    status: assembled.status,
    depth: "deep",
    groundingPageIds: assembled.groundingPageIds,
    body: assembled.body,
    today: args.today,
  })

  // When upgrading a Quick Spark seed, overwrite that page's path in place — capture its
  // current content as `before` so the changeset (and its revert) round-trip correctly.
  let path = draft.path
  let before: string | null = null
  if (args.seedPageId) {
    path = `${args.seedPageId}.md`
    before = await args.storage.read(path)
  }

  const change: FileChange = { path, before, after: draft.content }
  const changeset: Changeset = {
    id: makeChangesetId(),
    skill: "spark-deep",
    model: "tier:strong",
    timestamp: now().toISOString(),
    changes: [change],
  }

  await applyChangeset(args.storage, changeset)

  const ideaPageId = path.slice(0, -3)
  const outcome: DeepSparkOutcome = { kind: "idea", ideaPageId, changesetId: changeset.id, status: assembled.status }
  await logOutcome("idea", ideaPageId)

  return { outcome, costUsd, phaseCosts }
}
