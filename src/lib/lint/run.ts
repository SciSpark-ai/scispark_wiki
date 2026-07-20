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
import { runDeterministicChecks, findDuplicateAuthors } from "./checks"
import type { LintFinding, LintFixOutcome } from "./types"

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
//
// Recompute-at-apply for the OTHER mechanical fixes (broken-link,
// bad-frontmatter) — M12 Task 10: a review item stores `fix.before` = the FULL
// serialized page as it looked when the lint ran. When ONE page has SEVERAL
// fixable findings (e.g. two broken links), applying the first rewrites the
// page, so every sibling's stored `before` no longer matches disk and its
// applyChangeset would throw ChangesetConflictError on the second click. Rather
// than replay the stale stored fix, applyLintFix RECOMPUTES the deterministic
// checks against the current vault, re-finds THIS finding (by lintKind + fix
// path + `fixTarget` discriminator — the broken slug), and builds the changeset
// with before = current on-disk content and after = the fresh recompute. `before`
// then always matches disk regardless of sibling fixes. If the finding is gone
// from the fresh recompute (a sibling or a manual edit already resolved it) the
// call is a clean no-op success (LINT_FIX_NOOP_SENTINEL) so the UI dismisses the
// stale item without an error. One mechanical fix — bad-frontmatter's
// "missing updated" default — targets a page that parseDocument REJECTS, so it
// never appears in a fresh loadBundle; for that case applyLintFix falls back to
// the stored fix, but only when the page is still byte-identical to lint time
// (so `before` matches disk), otherwise no-op.
//
// duplicate-author (C6) is the one mechanical fix that spans MULTIPLE files
// (every page referencing the duplicate, plus deleting the duplicate itself)
// — it carries `fixes: FileChange[]` (see LintFinding.fixes) instead of the
// single-file `fix`. applyLintFix follows the same recompute-at-apply
// principle as the single-file fixes above, just re-running
// `findDuplicateAuthors` fresh against a `loadBundle` read at apply time (so
// every `before` in the rebuilt `fixes` list is already current-disk-content,
// no extra re-read needed) and re-finding this exact finding by its
// `fixTarget` (the duplicate page's id) before applying the whole list as one
// atomic changeset.
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
      ...(finding.fixTarget !== undefined ? { fixTarget: finding.fixTarget } : {}),
      ...(finding.fix ? { fix: finding.fix } : {}),
      ...(finding.fixes ? { fixes: finding.fixes } : {}),
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

/**
 * Stable per-finding identity used to dedupe against ALREADY-OPEN review
 * items before writing (see `dropFindingsAlreadyOpen` below). Distinct from
 * `matchFreshFindingByIdentity` above, which is an APPLY-time recompute (re-
 * finding one specific stored finding after a sibling fix mutated the vault)
 * — this one is a WRITE-time dedupe key comparing a batch of freshly detected
 * findings against the current open-review inbox. Exported so tests (and any
 * future caller needing the same key) don't have to reimplement the format.
 */
export function findingIdentity(f: Pick<LintFinding, "lintKind" | "fixTarget" | "pages">): string {
  return `${f.lintKind}|${f.fixTarget ?? ""}|${[...f.pages].sort().join(",")}`
}

/**
 * Drops findings whose identity (see `findingIdentity`) already matches an
 * OPEN review item, so re-running lint over an unchanged (or only partially
 * fixed) vault doesn't spam a second review item for the same still-open
 * finding — this matters once lint runs on a schedule (M12 follow-up Task 7),
 * not just on manual demand.
 *
 * Scoped to OPEN items only: `listReviews` excludes archived/dismissed ones,
 * so a finding whose review was DISMISSED can legitimately reappear here.
 * Dismissing a review item is a human decision to stop seeing THAT item, not
 * a fix — if the underlying issue is still detected on a later run, filing a
 * fresh review item is correct, not a dedupe bug. Accepted v1 behavior.
 */
async function dropFindingsAlreadyOpen(storage: VaultStorage, findings: LintFinding[]): Promise<LintFinding[]> {
  if (findings.length === 0) return findings
  const openReviews = await listReviews(storage)
  const openIdentities = new Set(
    openReviews
      .filter((r) => r.kind === "lint-finding" && r.lintKind !== undefined)
      .map((r) => findingIdentity({ lintKind: r.lintKind!, fixTarget: r.fixTarget, pages: r.pages })),
  )
  return findings.filter((f) => !openIdentities.has(findingIdentity(f)))
}

export interface RunLintDeterministicOptions {
  now?: () => Date
}

/**
 * Runs the deterministic lint checks (orphans, broken links, bad frontmatter,
 * index drift) over the current vault and writes one review item per finding
 * that isn't already open in the inbox (see `dropFindingsAlreadyOpen`) to the
 * shared inbox. Logs a `lint_run` event regardless of finding count — the
 * event and `findings` both report the FULL detected set (write-time dedupe
 * only affects which findings actually get a NEW review item, not what the
 * scan itself found).
 */
export async function runLintDeterministic(
  storage: VaultStorage,
  opts: RunLintDeterministicOptions = {},
): Promise<{ findings: LintFinding[]; reviewIds: string[] }> {
  const now = opts.now ?? (() => new Date())

  const bundle = await loadBundle(storage)
  const storedIndex = await storage.read("index.md")
  const findings = runDeterministicChecks(bundle, { storedIndex })

  const toWrite = await dropFindingsAlreadyOpen(storage, findings)
  const reviewIds = await writeFindingsAsReviews(storage, toWrite, now)

  await logEvent(storage, { type: "lint_run", mode: "deterministic", findingCount: findings.length }, now)

  return { findings, reviewIds }
}

export interface RunPostIngestLintOptions {
  now?: () => Date
}

/**
 * Scoped deterministic-lint verify step run automatically right after a
 * successful ingest apply (`src/lib/skills/ingest.ts`, post-`appendLog`) —
 * NOT a general lint run the user/schedule triggers, so unlike
 * `runLintDeterministic`/`runLintLlm` it does NOT log a `lint_run` event;
 * that event's `findingCount`/cost bookkeeping is for explicit lint runs, and
 * this is just a byproduct check riding along on the ingest that already ran.
 *
 * Runs the full deterministic checks against a fresh `loadBundle`, then
 * narrows to findings that are actually IN SCOPE for this ingest:
 * - only findings touching a page this ingest's changeset wrote (`pages`
 *   intersects `touchedPageIds`) — a pre-existing broken link on some
 *   unrelated, untouched page is not this ingest's concern to surface here;
 * - excludes `lintKind === "index-drift"` entirely — the caller (ingest.ts)
 *   already rebuilt index.md via `writeIndex` immediately before this runs,
 *   so any drift finding at this point would be stale/spurious by
 *   construction, not a real signal about the ingest.
 * Applies the same write-time dedupe as the other two run* functions
 * (`dropFindingsAlreadyOpen`) before writing review items.
 */
export async function runPostIngestLint(
  storage: VaultStorage,
  touchedPageIds: string[],
  opts: RunPostIngestLintOptions = {},
): Promise<{ findings: LintFinding[]; reviewIds: string[] }> {
  const now = opts.now ?? (() => new Date())
  const touched = new Set(touchedPageIds)

  const bundle = await loadBundle(storage)
  const storedIndex = await storage.read("index.md")
  const allFindings = runDeterministicChecks(bundle, { storedIndex })

  const findings = allFindings.filter(
    (f) => f.lintKind !== "index-drift" && f.pages.some((p) => touched.has(p)),
  )

  const toWrite = await dropFindingsAlreadyOpen(storage, findings)
  const reviewIds = await writeFindingsAsReviews(storage, toWrite, now)

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

  // Same write-time dedupe as runLintDeterministic (see dropFindingsAlreadyOpen)
  // — a contradiction/stale-claim pair the LLM re-flags on a later run must not
  // spam a second review item while the first is still open.
  const toWrite = await dropFindingsAlreadyOpen(storage, findings)
  const reviewIds = await writeFindingsAsReviews(storage, toWrite, now)

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
 * Returned when a mechanical fix does not produce a new changeset at apply
 * time. This covers TWO different outcomes the caller must not conflate — see
 * the returned `outcome` (`LintFixOutcome`, ./types) to tell them apart:
 * - "resolved": the finding is genuinely gone (a sibling fix or a manual edit
 *   already resolved it). Safe for the UI to dismiss the review item.
 * - "needs-manual": the finding is still there, just reclassified to
 *   advisory-only since lint time (e.g. a sibling duplicate-author fix
 *   changed this exact pair's classification). NOT safe to dismiss.
 * Not a real, loadable changeset id either way.
 */
export const LINT_FIX_NOOP_SENTINEL = "lint-fix-noop"

/**
 * Locates the fresh finding matching a stored review item's IDENTITY (same
 * lintKind, same target page, and — when the item carries one — the same
 * `fixTarget` discriminator) REGARDLESS of whether that fresh finding still
 * carries a `fix`. Used to tell "the finding is fully gone" (a sibling fix or
 * manual edit resolved it — outcome "resolved") apart from "the finding is
 * still there but no longer has a safe mechanical fix" (e.g. a sibling
 * duplicate-author fix reclassified this exact pair to advisory-only —
 * outcome "needs-manual") — a match that requires a `fix` to be present can't
 * make that distinction, since it would look identical (no match) in both
 * cases.
 */
function matchFreshFindingByIdentity(findings: LintFinding[], item: ReviewItem): LintFinding | undefined {
  return findings.find(
    (f) =>
      f.lintKind === item.lintKind &&
      f.pages.includes(item.pages[0]) &&
      (item.fixTarget === undefined || f.fixTarget === item.fixTarget),
  )
}

/**
 * Applies a stored lint finding's mechanical fix as an undoable changeset.
 * The result's `outcome` (see `LintFixOutcome` in ./types) tells the caller
 * what actually happened, since `changesetId === LINT_FIX_NOOP_SENTINEL` is
 * ambiguous by itself — it covers BOTH "already resolved, safe to dismiss"
 * and "still broken, reclassified to advisory, do NOT dismiss" (this used to
 * be conflated into one silent no-op — see the "needs-manual" case below).
 *
 * - "index-drift": recomputes index.md directly through the deterministic
 *   index-builder (writeIndex) and returns INDEX_DRIFT_FIX_SENTINEL / outcome
 *   "applied" (see the module comment for why it bypasses the changeset
 *   machinery).
 * - "duplicate-author": RECOMPUTES findDuplicateAuthors against the current
 *   vault, re-finds this finding by `fixTarget` (the duplicate page's id).
 *   - No match at all -> outcome "resolved" (the pair is gone — e.g. the
 *     duplicate was deleted out-of-band).
 *   - A match exists but no longer carries `fixes` (a sibling fix or manual
 *     edit reclassified this exact pair to advisory-only) -> outcome
 *     "needs-manual" — the finding is still real, nothing is written.
 *   - Otherwise applies the whole `fixes` list as one atomic multi-file
 *     changeset -> outcome "applied" (see the module comment).
 * - every other mechanical fix (broken-link, bad-frontmatter): RECOMPUTES the
 *   deterministic checks against the current vault and rebuilds the fix so
 *   `before` always matches disk, even after a sibling fix on the same page has
 *   already been applied — this is what stops the second Fix click from
 *   throwing ChangesetConflictError. Undo works via the normal loadChangeset +
 *   revertChangeset path (same as ingest changesets). Distinguishes "resolved"
 *   (no trace of this finding's identity in the fresh recompute) from
 *   "needs-manual" (the finding's identity still matches but the fresh
 *   version has no `fix`) the same way as duplicate-author above. See the
 *   module comment for the full rationale and the bad-frontmatter fallback.
 */
export async function applyLintFix(
  storage: VaultStorage,
  reviewId: string,
): Promise<{ changesetId: string; outcome: LintFixOutcome }> {
  const item = await findReviewItem(storage, reviewId)
  if (!item) throw new Error(`review item not found: ${reviewId}`)
  if (!item.fix && !item.fixes) throw new Error(`review item ${reviewId} has no fix to apply`)

  if (item.lintKind === "index-drift") {
    const bundle = await loadBundle(storage)
    await writeIndex(storage, bundle)
    return { changesetId: INDEX_DRIFT_FIX_SENTINEL, outcome: "applied" }
  }

  if (item.lintKind === "duplicate-author") {
    // Recompute fresh (see the module comment) rather than replaying the
    // stored `fixes` — the review item's snapshot could be stale (a manual
    // edit, or another duplicate-author fix on the same canonical author,
    // landed since this finding was written).
    const bundle = await loadBundle(storage)
    const match = findDuplicateAuthors(bundle).find((f) => f.fixTarget === item.fixTarget)
    if (!match) return { changesetId: LINT_FIX_NOOP_SENTINEL, outcome: "resolved" }
    if (!match.fixes || match.fixes.length === 0) {
      return { changesetId: LINT_FIX_NOOP_SENTINEL, outcome: "needs-manual" }
    }

    const changeset: Changeset = {
      id: makeChangesetId(),
      skill: "lint",
      model: "none",
      timestamp: new Date().toISOString(),
      changes: match.fixes,
    }
    await applyChangeset(storage, changeset)
    if ((await loadChangeset(storage, changeset.id)) === null) {
      throw new Error(`applyChangeset for ${changeset.id} did not persist a changeset record`)
    }
    return { changesetId: changeset.id, outcome: "applied" }
  }

  // Every OTHER lintKind's mechanical fix is single-file (index-drift and
  // duplicate-author, the only `fixes`-only kinds, both returned above).
  if (!item.fix) throw new Error(`review item ${reviewId} has no single-file fix to apply`)

  // Recompute the deterministic checks against the CURRENT vault and re-find
  // this finding's identity, so `before` is derived from the live page rather
  // than the (possibly sibling-mutated) copy stored at lint time.
  const bundle = await loadBundle(storage)
  const storedIndex = await storage.read("index.md")
  const freshFindings = runDeterministicChecks(bundle, { storedIndex })
  const identityMatch = matchFreshFindingByIdentity(freshFindings, item)

  // The change to apply: before = current on-disk content (guarantees the
  // conflict check passes), after = the freshly-recomputed, schema-validated fix.
  let change: { path: string; before: string | null; after: string } | null = null

  if (identityMatch === undefined) {
    // No trace of this finding's identity in the fresh recompute at all. Fall
    // back to the stored fix, but only when the page is byte-identical to
    // lint time (so `before` still matches disk and applyChangeset won't
    // conflict). Covers the bad-frontmatter "missing updated" fix, whose page
    // parseDocument rejects — so it never appears in a fresh loadBundle
    // (matched or not). If disk has since changed too, the finding was
    // resolved elsewhere.
    const current = await storage.read(item.fix.path)
    if (current !== null && current === item.fix.before) {
      change = { path: item.fix.path, before: item.fix.before, after: item.fix.after }
    } else {
      return { changesetId: LINT_FIX_NOOP_SENTINEL, outcome: "resolved" }
    }
  } else if (identityMatch.fix) {
    const current = await storage.read(identityMatch.fix.path)
    if (current !== null) {
      change = { path: identityMatch.fix.path, before: current, after: identityMatch.fix.after }
    } else {
      return { changesetId: LINT_FIX_NOOP_SENTINEL, outcome: "resolved" }
    }
  } else {
    // The finding's identity still matches, but the fresh recompute no longer
    // has a mechanical `fix` for it (reclassified to advisory-only). Still
    // real — do not dismiss it, do not write anything.
    return { changesetId: LINT_FIX_NOOP_SENTINEL, outcome: "needs-manual" }
  }

  const changeset: Changeset = {
    id: makeChangesetId(),
    skill: "lint",
    model: "none",
    timestamp: new Date().toISOString(),
    changes: [change],
  }
  await applyChangeset(storage, changeset)
  // Confirm the record really landed (applyChangeset writes it as part of the
  // same atomic apply) — surfaces a clearer error than a later loadChangeset(null).
  if ((await loadChangeset(storage, changeset.id)) === null) {
    throw new Error(`applyChangeset for ${changeset.id} did not persist a changeset record`)
  }

  return { changesetId: changeset.id, outcome: "applied" }
}
