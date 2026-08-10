import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { Changeset, FileChange } from "../vault/types"
import { makeChangesetId } from "../vault/changesets"
import { commitChangeset, type MutationWarning } from "../vault/mutations"
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
  warnings?: MutationWarning[]
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
// model's pricing, NOT a budget guarantee. It exists to be shown to the user
// BEFORE they confirm a spend, so it must be honest about the product's
// documented cost range (CLAUDE.md M9: "Deep Spark ... ~$1-3, always
// user-confirmed with a cost estimate") rather than a best-case lowball.
// ---------------------------------------------------------------------------

const ESTIMATE_MODEL = "claude-opus-4-8"

/**
 * Recalibrated 2026-07-13 (Task 7 review, Finding 1): the previous numbers here summed to
 * ~$0.20 — a 5x+ under-quote against the $1-3 contract above, which a spend-confirmation
 * dialog cannot afford (under-quoting is misleading; over-quoting is merely conservative).
 * These are deliberately generous per-phase input/output token estimates, at the default
 * strong-tier model's pricing — NOT a tight bottom-up sum of today's grounding-assembly
 * caps (grounding.ts's MAX_FRESH_PAPERS=20 / SNIPPET_CHARS=300 / MAX_SNIPPET_PAGES=6 alone
 * only total a few thousand tokens of context). They run higher than that bottom-up figure
 * because: real-world grounding skews larger as those caps get tuned; every phase is a
 * structured-output call whose request carries schema/tool-definition overhead this
 * per-token model doesn't itemize; and this is meant to be read BEFORE the spend, when
 * erring generous is the safer failure mode. Output tokens still stay under each phase's
 * `maxTokens` cap (bottleneck.ts=2048, ideation.ts=4096, scoop.ts=1024/2048, audit.ts=3072)
 * but sit much closer to it than before — real structured JSON responses (a full
 * falsification plan, 5 audit checks with concrete notes) are verbose in practice.
 * bottleneck/ideation/audit carry the full grounding context (vault snippets + up to 20
 * fresh papers + the ~46-card pattern index) on the input side; scoop-verdict carries the
 * collision hits block (up to 20 hits); scoop-terms is the one genuinely light call.
 */
const PHASE_TOKEN_ESTIMATES: Record<string, { inputTokens: number; outputTokens: number }> = {
  bottleneck: { inputTokens: 20000, outputTokens: 1200 },
  ideation: { inputTokens: 30000, outputTokens: 3200 },
  "scoop-terms": { inputTokens: 6000, outputTokens: 800 },
  "scoop-verdict": { inputTokens: 24000, outputTokens: 1700 },
  audit: { inputTokens: 28000, outputTokens: 2600 },
}

/** Every phase after bottleneck — i.e. everything `runIdeationScoopAudit` (below) re-runs
 * in full on the single internal abandon-retry. bottleneck and the (free, non-LLM)
 * grounding phase never re-run, so they're excluded from the retry headroom below. */
const RETRYABLE_PHASES = new Set(["ideation", "scoop-terms", "scoop-verdict", "audit"])

/**
 * Blended headroom on the retryable phases: a fired retry fully DOUBLES their cost (1x ->
 * 2x), while no retry leaves them at 1x. Weighting at 1.5x approximates "roughly even odds
 * of one retry firing" in a real run — conservative enough not to under-quote, without
 * assuming every run retries (2x, which would overshoot into alarmist territory).
 */
const RETRY_HEADROOM_FACTOR = 1.5

export async function estimateDeepSparkCost(): Promise<number> {
  const price = PRICES[ESTIMATE_MODEL]
  if (!price) return 0
  let total = 0
  for (const [phase, { inputTokens, outputTokens }] of Object.entries(PHASE_TOKEN_ESTIMATES)) {
    const passCost = (inputTokens / 1e6) * price.inPerM + (outputTokens / 1e6) * price.outPerM
    total += RETRYABLE_PHASES.has(phase) ? passCost * RETRY_HEADROOM_FACTOR : passCost
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

/**
 * In-flight guard (blessed pattern, ported from src/lib/trending/dashboard.ts's
 * `inFlight` WeakMap): two browser tabs can both POST /api/skills/spark/deep
 * against the same local server for the same vault (e.g. one left open from
 * yesterday) — without a guard that's two concurrent Deep Sparks, each a real
 * $1-3 LLM spend, run against the same storage. Concurrent calls for the SAME
 * `args.storage` now share one in-flight run — every caller gets the same
 * `DeepSparkResult` promise/object, and every phase's LLM call (and the single
 * `spark_run` event) fires only once, not once per caller. A call made AFTER
 * the shared run has settled starts a fresh run.
 *
 * Nuance vs. trending's dashboard guard: sharing here means the SECOND
 * caller's `direction`/`clusterPageIds`/`seedPageId` (and everything else in
 * its `opts`) are silently ignored — tab B gets tab A's idea, not its own,
 * even if tab B asked about a different research direction. For a $1-3 spend
 * that is the correct conservative default for v1: it is far better for tab B
 * to (surprisingly) receive tab A's idea than for the harness to ever fire two
 * concurrent paid Deep Spark runs. If a future caller needs guaranteed-distinct
 * concurrent runs, it must key the in-flight map on more than just `storage`
 * (e.g. storage + direction).
 *
 * Also per the trending precedent: the second caller's `onPhase` never fires
 * (only the first caller's `opts` — including its `onPhase` callback — drive
 * the shared run), so a second tab's progress UI will not update phase-by-phase
 * until the shared promise resolves. Acceptable for the same reason: this is a
 * spend-safety guard, not a UX feature.
 */
const inFlight = new WeakMap<VaultStorage, Promise<DeepSparkResult>>()

export async function runDeepSpark(args: DeepSparkArgs): Promise<DeepSparkResult> {
  const existing = inFlight.get(args.storage)
  if (existing) return existing

  const run = runDeepSparkUncached(args).finally(() => {
    inFlight.delete(args.storage)
  })
  inFlight.set(args.storage, run)
  return run
}

async function runDeepSparkUncached(args: DeepSparkArgs): Promise<DeepSparkResult> {
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

  const mutation = await commitChangeset(args.storage, changeset, {
    op: "spark-save",
    summary: path.slice(0, -3),
  })

  const ideaPageId = path.slice(0, -3)
  const outcome: DeepSparkOutcome = { kind: "idea", ideaPageId, changesetId: changeset.id, status: assembled.status }
  await logOutcome("idea", ideaPageId)

  return {
    outcome,
    costUsd,
    phaseCosts,
    ...(mutation.warnings.length > 0 ? { warnings: mutation.warnings } : {}),
  }
}
