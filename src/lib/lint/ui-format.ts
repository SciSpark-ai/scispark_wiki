import type { LintKind } from "./types"

// ---------------------------------------------------------------------------
// Pure formatting/mapping helpers for the Lint UI (src/app/wiki/inbox/page.tsx,
// M12 Task 10). No React, no I/O — kept separate so they're unit-testable
// without mounting the page, mirroring src/lib/spark/ui-format.ts.
// ---------------------------------------------------------------------------

/** "~$0.12 — proceed?" — the deep-lint confirm-dialog prompt. Matches
 * formatDeepSparkConfirm's wording contract exactly (M9 Task 8), per this
 * task's brief ("same estimate→confirm idiom as Deep Spark"). */
export function formatDeepLintConfirm(costUsd: number): string {
  return `~$${costUsd.toFixed(2)} — proceed?`
}

/** "3 findings" / "1 finding" / "no findings" — summary shown after a lint
 * run (deterministic or deep) completes. */
export function formatLintFindingCount(count: number): string {
  if (count <= 0) return "no findings"
  return `${count} finding${count === 1 ? "" : "s"}`
}

/** Human label for a LintFinding's lintKind — shown as a secondary tag next
 * to a lint-finding review item's generic "Lint" kind badge, so the inbox
 * distinguishes an orphan page from a contradiction at a glance. */
const LINT_KIND_LABEL: Record<LintKind, string> = {
  orphan: "Orphan page",
  "broken-link": "Broken link",
  "bad-frontmatter": "Bad frontmatter",
  "index-drift": "Index drift",
  contradiction: "Contradiction",
  "stale-claim": "Stale claim",
}

/** Maps a LintKind to its human label; falls back to the raw key for any
 * kind this UI doesn't recognize, so the tag never renders blank. */
export function lintKindLabel(kind: LintKind): string {
  return LINT_KIND_LABEL[kind] ?? kind
}

/** "index 2 of 5" — deep-lint per-pair progress text (from runLintLlmRemote's
 * onPair callback, 0-indexed `index`). */
export function formatLintPairProgress(progress: { index: number; total: number }): string {
  return `Judging pair ${progress.index + 1} of ${progress.total}…`
}
