import type { VaultStorage } from "../vault/storage"
import { loadBundle, type Bundle } from "../vault/bundle"
import { applyChangeset, loadChangeset, makeChangesetId } from "../vault/changesets"
import { writeIndex } from "../vault/index-builder"
import type { Changeset } from "../vault/types"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import { runSkill } from "../skills/runner"
import { lintScreenSkill, lintJudgeSkill } from "../skills/lint"
import { logEvent } from "../events/log"
import type { ReviewItem } from "../wiki/review-queue"
import { listReviews } from "../wiki/review-queue"
import { runDeterministicChecks } from "./checks"
import type { LintFinding } from "./types"

// ---------------------------------------------------------------------------
// Lint orchestrator (M12 Task 8, per docs/superpowers/sdd/m12-task-8-brief.md):
// turns LintFinding[] (Task 6 deterministic checks, Task 7 LLM skills) into
// review items in the shared inbox (.scispark/review/), and applies a
// finding's mechanical `fix` as a normal, undoable changeset.
//
// index-drift decision (carried forward from the Task 6 review): the mechanical
// `fix` findIndexDrift() computes targets index.md, which is a PROTECTED path
// (see findProtectedPaths in ../vault/changesets.ts) — applyChangeset rejects
// any changeset touching it. index.md is also a fully deterministic projection
// of the current wiki pages (buildIndexMarkdown), already rewritten via
// writeIndex() on every ingest/undo (see ../skills/ingest.ts). Recomputing it
// is therefore always safe and idempotent, so applyLintFix special-cases
// lintKind "index-drift": it bypasses the changeset machinery entirely and
// calls the same deterministic index-builder write path the rest of the app
// uses, rather than either rejecting the fix or smuggling it through
// applyChangeset. There is nothing meaningful to "undo" for this one fix kind
// — reverting would mean writing a stale index back over a fresh one, exactly
// the bug the fix corrects — so applyLintFix returns a non-persisted sentinel
// changesetId ("index-rebuild") for it instead of a real changeset id. The
// finding is still surfaced as a normal review item (with its `fix` stored)
// so the inbox can show it and offer the one-click apply.
// ---------------------------------------------------------------------------

const REVIEW_DIR = ".scispark/review"

function makeReviewId(now: () => Date, index: number): string {
  const hex = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")
  return `lint-${now().getTime()}-${index}-${hex}`
}

/** Writes one ReviewItem per finding. A single bad write (thrown by storage)
 * is caught and skipped so it can't abort the rest of the batch — the caller
 * gets back exactly the ids that were actually persisted. */
async function writeFindingsAsReviews(
  storage: VaultStorage,
  findings: LintFinding[],
  now: () => Date,
): Promise<string[]> {
  const nowIso = now().toISOString()
  const reviewIds: string[] = []

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i]
    const id = makeReviewId(now, i)
    const item: ReviewItem = {
      id,
      createdAt: nowIso,
      kind: "lint-finding",
      lintKind: finding.lintKind,
      title: finding.title,
      description: finding.description,
      pages: finding.pages,
      ...(finding.fix ? { fix: finding.fix } : {}),
    }
    try {
      await storage.write(`${REVIEW_DIR}/${id}.json`, JSON.stringify(item, null, 2))
      reviewIds.push(id)
    } catch (err) {
      console.warn(`[lint] failed to write review item for finding "${finding.lintKind}"`, err)
    }
  }

  return reviewIds
}

export interface RunLintDeterministicOptions {
  now?: () => Date
}

/**
 * Runs the deterministic lint checks (orphans, broken links, bad frontmatter,
 * index drift) over the current vault and writes one review item per finding
 * to the shared inbox. Logs a `lint_run` event regardless of finding count.
 */
export async function runLintDeterministic(
  storage: VaultStorage,
  opts: RunLintDeterministicOptions = {},
): Promise<{ findings: LintFinding[]; reviewIds: string[] }> {
  const now = opts.now ?? (() => new Date())

  const bundle = await loadBundle(storage)
  const storedIndex = await storage.read("index.md")
  const findings = runDeterministicChecks(bundle, { storedIndex })

  const reviewIds = await writeFindingsAsReviews(storage, findings, now)

  await logEvent(storage, { type: "lint_run", mode: "deterministic", findingCount: findings.length }, now)

  return { findings, reviewIds }
}

// ---------------------------------------------------------------------------
// LLM lint run: screen -> judge per candidate pair -> contradiction/stale-claim
// findings.
// ---------------------------------------------------------------------------

/** One line per page: id, title, a short summary (first non-blank body line),
 * and its related[]/sources[] adjacency — the compact input lintScreenSkill's
 * system prompt expects (src/lib/skills/lint.ts#LintScreenInput). */
function buildLintPageList(bundle: Bundle): string {
  const lines: string[] = []
  for (const page of bundle.pages.values()) {
    const summaryLine = page.body.split("\n").find((l) => l.trim().length > 0) ?? ""
    const summary = summaryLine.trim().slice(0, 160)
    const related = page.frontmatter.related?.length ? ` related=[${page.frontmatter.related.join(", ")}]` : ""
    const sources = page.frontmatter.sources?.length ? ` sources=[${page.frontmatter.sources.join(", ")}]` : ""
    lines.push(`- ${page.id} — ${page.frontmatter.title}: ${summary}${related}${sources}`)
  }
  return lines.join("\n")
}

export interface RunLintLlmOptions {
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
  /** Called once per candidate pair, before that pair's judge call runs. */
  onProgress?: (info: { index: number; total: number; pair: { a: string; b: string } }) => void
}

/**
 * Runs the LLM lint pipeline: lintScreenSkill narrows the full page set down
 * to candidate pairs, then lintJudgeSkill reads each pair's full bodies and
 * decides contradiction / stale-claim / none. Non-"none" verdicts become
 * review items. Cost is summed across the screen call and every judge call.
 */
export async function runLintLlm(
  storage: VaultStorage,
  opts: RunLintLlmOptions = {},
): Promise<{ findings: LintFinding[]; reviewIds: string[]; costUsd: number }> {
  const now = opts.now ?? (() => new Date())
  const bundle = await loadBundle(storage)

  let costUsd = 0

  const screenRun = await runSkill({
    skill: lintScreenSkill,
    input: { pageList: buildLintPageList(bundle) },
    storage,
    settings: opts.settings,
    providerOverride: opts.providerOverride,
    now,
  })
  costUsd += screenRun.costUsd

  const pairs = screenRun.status === "ok" && screenRun.output ? screenRun.output.pairs : []

  const findings: LintFinding[] = []
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    opts.onProgress?.({ index: i, total: pairs.length, pair: { a: pair.a, b: pair.b } })

    const pageA = bundle.pages.get(pair.a)
    const pageB = bundle.pages.get(pair.b)
    // The screen skill only ever sees page ids we handed it, but treat a
    // hallucinated/stale id defensively rather than throwing mid-batch.
    if (!pageA || !pageB) continue

    const judgeRun = await runSkill({
      skill: lintJudgeSkill,
      input: { bodyA: pageA.body, bodyB: pageB.body },
      storage,
      settings: opts.settings,
      providerOverride: opts.providerOverride,
      now,
    })
    costUsd += judgeRun.costUsd

    if (judgeRun.status !== "ok" || !judgeRun.output) continue
    const { verdict, explanation } = judgeRun.output
    if (verdict === "none") continue

    findings.push({
      lintKind: verdict,
      title: `${verdict === "contradiction" ? "Contradiction" : "Stale claim"} between "${pageA.frontmatter.title}" and "${pageB.frontmatter.title}"`,
      description: explanation,
      pages: [pageA.id, pageB.id],
    })
  }

  const reviewIds = await writeFindingsAsReviews(storage, findings, now)

  await logEvent(storage, { type: "lint_run", mode: "llm", findingCount: findings.length, costUsd }, now)

  return { findings, reviewIds, costUsd }
}

// ---------------------------------------------------------------------------
// Applying a finding's fix (the inbox's one-click fix).
// ---------------------------------------------------------------------------

async function findReviewItem(storage: VaultStorage, reviewId: string): Promise<ReviewItem | null> {
  const items = await listReviews(storage)
  return items.find((i) => i.id === reviewId) ?? null
}

/** Returned for index-drift fixes, which bypass the changeset machinery
 * entirely (see the module-level comment above) — not a real, loadable
 * changeset id. */
export const INDEX_DRIFT_FIX_SENTINEL = "index-rebuild"

/**
 * Applies a stored lint finding's mechanical fix. For every lintKind except
 * "index-drift" this builds a one-file Changeset (skill "lint") and applies
 * it through the normal applyChangeset path, so undo works via the existing
 * loadChangeset + revertChangeset path (same as ingest changesets). For
 * "index-drift" it instead recomputes index.md directly through the
 * deterministic index-builder (writeIndex) — see the module comment for why.
 */
export async function applyLintFix(storage: VaultStorage, reviewId: string): Promise<{ changesetId: string }> {
  const item = await findReviewItem(storage, reviewId)
  if (!item) throw new Error(`review item not found: ${reviewId}`)
  if (!item.fix) throw new Error(`review item ${reviewId} has no fix to apply`)

  if (item.lintKind === "index-drift") {
    const bundle = await loadBundle(storage)
    await writeIndex(storage, bundle)
    return { changesetId: INDEX_DRIFT_FIX_SENTINEL }
  }

  const changeset: Changeset = {
    id: makeChangesetId(),
    skill: "lint",
    model: "none",
    timestamp: new Date().toISOString(),
    changes: [{ path: item.fix.path, before: item.fix.before, after: item.fix.after }],
  }
  await applyChangeset(storage, changeset)
  // Confirm the record really landed (applyChangeset writes it as part of the
  // same atomic apply) — surfaces a clearer error than a later loadChangeset(null).
  if ((await loadChangeset(storage, changeset.id)) === null) {
    throw new Error(`applyChangeset for ${changeset.id} did not persist a changeset record`)
  }

  return { changesetId: changeset.id }
}
