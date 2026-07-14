import type { DeepSparkOutcome } from "./deep"

// ---------------------------------------------------------------------------
// Pure formatting/mapping helpers for the Spark UI (src/components/spark/*,
// src/app/spark/page.tsx). No React, no I/O — kept separate so they're
// unit-testable without mounting components, per the M9 Task 8 brief ("any
// pure helper you extract ... unit-test it").
// ---------------------------------------------------------------------------

/** "3 grounding sources" / "1 grounding source" / "no grounding" — used on
 * SeedCard and IdeaGallery cards for a page's grounding-link count
 * (`groundingPageIds.length` on a seed, `frontmatter.related.length` on a
 * saved idea page). */
export function formatGroundingCount(count: number): string {
  if (count <= 0) return "no grounding"
  return `${count} grounding source${count === 1 ? "" : "s"}`
}

/** "~$1.23 — proceed?" — the Deep Spark confirm-dialog prompt, matching the
 * M9 task-8 brief's wording contract exactly. */
export function formatDeepSparkConfirm(costUsd: number): string {
  return `~$${costUsd.toFixed(2)} — proceed?`
}

/** Ordered Deep Spark phases as surfaced by `runDeepSpark`'s `onPhase`
 * callback (src/lib/spark/deep.ts) — grounding has no LLM call of its own but
 * is still a phase the UI shows progress for. */
export const DEEP_SPARK_PHASES = ["grounding", "bottleneck", "ideation", "scoop-check", "audit"] as const
export type DeepSparkPhase = (typeof DEEP_SPARK_PHASES)[number]

const DEEP_SPARK_PHASE_LABELS: Record<DeepSparkPhase, string> = {
  grounding: "Grounding in your vault…",
  bottleneck: "Diagnosing the bottleneck…",
  ideation: "Generating idea candidates…",
  "scoop-check": "Checking for prior work…",
  audit: "Auditing the idea…",
}

/** Human label for a Deep Spark phase key; falls back to the raw key for any
 * phase this UI doesn't recognize, so progress text never renders blank. */
export function deepSparkPhaseLabel(phase: string): string {
  return DEEP_SPARK_PHASE_LABELS[phase as DeepSparkPhase] ?? phase
}

export type DeepRunStatus = "idle" | "running" | "done" | "error"
export type SeedSaveStatus = "idle" | "saving" | "saved" | "error"

/** Whether a seed's "Develop fully" button must be non-clickable.
 *
 * Deep Spark is a paid, real-LLM action, so only one run may ever be in
 * flight at a time: `deepRunStatus === "running"` is checked index-agnostic
 * (true for every seed, not just whichever one the active run belongs to) so
 * a second run can never be started while the first is still writing — this
 * is what prevents the top-level Deep Spark button and every other seed's
 * "Develop fully" from clobbering the in-flight run's tracked state or
 * double-spending on it (M9 task-8 review finding 1).
 *
 * `saveStatus === "saving"` additionally blocks a same-seed race: "Develop
 * fully" calls `persistSeed` first, which writes the seed's idea page at a
 * deterministic path; if the user's separate "Save" click is still writing
 * that same path, starting a develop run too would race a second write onto
 * it (M9 task-8 review finding 3). */
export function isDevelopButtonDisabled(deepRunStatus: DeepRunStatus, saveStatus: SeedSaveStatus): boolean {
  return deepRunStatus === "running" || saveStatus === "saving"
}

export interface DeepOutcomeDisplay {
  kind: DeepSparkOutcome["kind"]
  heading: string
  message: string
}

/** Maps a `DeepSparkOutcome` to display copy. `do_not_generate`/`abandoned`
 * surface the orchestrator's own honest reason verbatim — never a forced
 * idea — per the task-8 brief's behavior contract. */
export function describeDeepOutcome(outcome: DeepSparkOutcome): DeepOutcomeDisplay {
  switch (outcome.kind) {
    case "idea":
      return { kind: "idea", heading: "Idea generated", message: `Status: ${outcome.status}` }
    case "do_not_generate":
      return { kind: "do_not_generate", heading: "No idea generated", message: outcome.reason }
    case "abandoned":
      return { kind: "abandoned", heading: "Idea abandoned after review", message: outcome.reason }
  }
}
