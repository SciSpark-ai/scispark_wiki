# Loop-Engineering Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the skill harness a real "loop" per the loop-engineering model: observable run outcomes (orchestrator ledger), a heartbeat (server-side scheduler), honest failure behavior (trending backoff instead of silent re-spend), the accept-rate metric (changeset revert telemetry → cost per accepted change), an automated post-ingest verify step (scoped deterministic lint), and a projective budget gate.

**Architecture:** All six items ride on existing patterns: JSONL append with the storage-keyed write-queue mutex (like `events/log.ts`), pure summary functions (like `usage-summary.ts`), orchestrator-owns-storage, and route-level instrumentation via one shared `withLedger` wrapper. The scheduler is a Next.js `instrumentation.ts` `register()` hook starting a singleton interval in the local Node server (M11 local-runtime model — the server IS the runtime, so a real heartbeat is now legitimate).

**Tech Stack:** TypeScript, Next.js App Router (local server), Vitest, zod. No new dependencies.

## Global Constraints

- New code must add zero `npm run lint` errors/warnings (baseline 8 errors/6 warnings, all in fork-era mock files).
- No raw hex colors in components; token classes only (SP1 source guard).
- Browser-purity: no server-only imports reachable from client bundles (repo-wide gate test). `src/lib/scheduler/**`, `src/instrumentation.ts`, ledger writes are server-only; the SpendPanel consumes them only via `/api/usage` JSON.
- Source-hygiene: no raw control bytes in source files.
- All timestamps ISO-8601 via injected `now: () => Date` defaulting to `new Date()` — pure/deterministic under test (repo convention).
- Never write `.scispark/settings.json` outside `withSettingsWrite` (not needed by this plan — no settings changes).
- Vault paths: everything new under `.scispark/` (ledger: `.scispark/runs/ledger.jsonl`, trending failure marker: `.scispark/trending/refresh-failure.json`).
- Tests colocated in `__tests__/` next to the module, named `<module>.test.ts`, using the in-memory `VaultStorage` test double already used by neighboring tests (see `src/lib/events/__tests__/` for the pattern).
- Commit after every task with a conventional-commit message.

---

### Task 1: Orchestrator run ledger module

**Files:**
- Create: `src/lib/runs/ledger.ts`
- Test: `src/lib/runs/__tests__/ledger.test.ts`

**Interfaces:**
- Produces (later tasks rely on these exact names):
  - `type OrchestratorName = "feed-refresh" | "trending-refresh" | "consolidation" | "ingest" | "lint-deterministic" | "lint-llm" | "spark-deep" | "enrich"`
  - `type RunTrigger = "user" | "schedule"`
  - `interface OrchestratorRunRecord { ts: string; orchestrator: OrchestratorName; trigger: RunTrigger; status: "ok" | "degraded" | "failed" | "skipped"; reason?: string; costUsd?: number; meta?: Record<string, unknown> }`
  - `recordOrchestratorRun(storage: VaultStorage, rec: Omit<OrchestratorRunRecord, "ts">, now?: () => Date): Promise<void>` — appends one line to `.scispark/runs/ledger.jsonl`; never throws (catch + `console.warn`, mirroring `logEvent`).
  - `readLedger(storage: VaultStorage, opts?: { limit?: number }): Promise<OrchestratorRunRecord[]>` — newest-first, default limit 50, tolerant of corrupt lines.
  - `withLedger<T>(storage, opts: { orchestrator: OrchestratorName; trigger: RunTrigger; now?: () => Date }, fn: () => Promise<{ result: T; status: OrchestratorRunRecord["status"]; reason?: string; costUsd?: number; meta?: Record<string, unknown> }>): Promise<T>` — runs `fn`, records the returned status; on throw records `{status: "failed", reason: err.message}` and **rethrows**.

**Implementation notes:** copy the write-queue mutex pattern from `src/lib/events/log.ts:26-61` verbatim (own `WeakMap`). `LEDGER_PATH = ".scispark/runs/ledger.jsonl"`. `readLedger` parses line-by-line, skips corrupt lines (pattern: `metering.ts:81-95`), returns `records.slice(-limit).reverse()`.

- [ ] **Step 1:** Write failing tests: append+read round-trip (2 records, newest first); corrupt line skipped; `withLedger` success path records returned status/cost and returns `result`; `withLedger` throw path records `failed` with the error message and rethrows; `recordOrchestratorRun` swallows a storage write throw.
- [ ] **Step 2:** `npx vitest run src/lib/runs` — expect FAIL (module missing).
- [ ] **Step 3:** Implement `ledger.ts` per the interface above.
- [ ] **Step 4:** `npx vitest run src/lib/runs` — expect PASS.
- [ ] **Step 5:** Commit: `feat(runs): orchestrator run ledger (jsonl + withLedger wrapper)`

---

### Task 2: Trending auto-refresh failure backoff

**Files:**
- Modify: `src/lib/trending/auto-refresh.ts` (whole file is 50 lines; read it first)
- Test: `src/lib/trending/__tests__/auto-refresh.test.ts` (extend existing)

**Interfaces:**
- `maybeAutoRefreshTrending` return union becomes `"refreshed" | "fresh" | "no-fields" | "backoff" | "failed"`.
- New exported constants: `REFRESH_FAILURE_PATH = ".scispark/trending/refresh-failure.json"`, `backoffMs(consecutiveFailures: number): number` (pure; `min(30min * 2^(n-1), 6h)`).
- Marker shape: `{ lastFailureAt: string; consecutiveFailures: number; lastError: string }`.

**Behavior (this closes the silent re-spend bug):** when the staleness check says "refresh needed":
1. Read the marker. Ignore it if missing, unparseable, **or** `cached !== null && cached.generatedAt > marker.lastFailureAt` (a successful refresh happened after the failure — marker obsolete).
2. If a live marker exists and `now < lastFailureAt + backoffMs(consecutiveFailures)` → return `"backoff"` without spending.
3. Otherwise run `runTrendingDashboard` inside try/catch:
   - success → delete the marker (via `storage.delete`, tolerate throw) → `"refreshed"`.
   - throw → write marker with `consecutiveFailures = (previous live marker?.consecutiveFailures ?? 0) + 1`, `lastError = err.message` → return `"failed"` (do NOT rethrow — both call sites fire-and-forget today; the status string + Task 3's ledger record are the surfacing).

Manual refresh (`/trending` page → `runTrendingDashboard` directly) is untouched and never backs off.

- [ ] **Step 1:** Write failing tests: (a) orchestrator throws → returns `"failed"` and marker written with `consecutiveFailures: 1`; (b) second call inside the backoff window → `"backoff"`, orchestrator NOT invoked (assert via spy searchFn/injected runner — follow the existing test's stubbing pattern); (c) call after window elapses → runs again, failure increments to 2 and window widens; (d) success → marker deleted, `"refreshed"`; (e) marker older than `cached.generatedAt` is ignored; (f) `backoffMs` values: 1→30m, 2→1h, 3→2h, 5→6h cap.
- [ ] **Step 2:** Run tests — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/lib/trending` — expect PASS (including untouched existing tests).
- [ ] **Step 5:** Commit: `fix(trending): failure marker + exponential backoff stops silent paid re-refresh on every visit`

---

### Task 3: Instrument orchestrator call sites with the ledger

**Files (read each before editing; wrap the orchestrator invocation in `withLedger` from Task 1):**
- Modify: `src/app/api/skills/feed/refresh/route.ts` — `feed-refresh`; ok always (throw = failed via wrapper); `costUsd: result.costUsd`, `meta: { itemCount: result.items.length }`.
- Modify: `src/app/api/skills/trending/auto-refresh/route.ts` — `trending-refresh`; map return: `"refreshed"` → ok, `"fresh" | "no-fields" | "backoff"` → skipped (reason = the status), `"failed"` → failed with `reason` read from the marker's `lastError` (read `REFRESH_FAILURE_PATH`).
- Modify: the manual trending refresh call site (find it: `grep -rn "runTrendingDashboard" src/app`) — `trending-refresh`, status degraded when any panel has `surveyError` (reason = first `surveyError`), else ok.
- Modify: `src/app/api/skills/consolidate/route.ts` — `consolidation`; map `runConsolidation` statuses: `"skipped"` → skipped, `"unchanged" | "applied"` → ok (reason = status), pass `costUsd`.
- Modify: `src/app/api/skills/ingest/route.ts` — `ingest`; `run.status !== "ok"` → failed (existing throw path — let `withLedger` capture it); `run.output.status === "draft"` → degraded with `reason: \`draft: ${errors.length} validation errors\``; else ok. `costUsd: run.costUsd`.
- Modify: `src/app/api/skills/lint/route.ts` (and its deterministic/llm entry points — read the route to see how modes dispatch) — `lint-deterministic` / `lint-llm`; ok with `meta: { findingCount }`, `costUsd` for llm.
- Modify: `src/app/api/skills/spark/deep/route.ts` — `spark-deep`; outcome `idea` → ok, `abandoned`/`do_not_generate` → degraded (reason = outcome), throw → failed.
- Modify: `src/app/api/skills/enrich/route.ts` — `enrich`; `applied: false` → degraded (`reason: "not applied"`), else ok.
- Test: `src/app/api/__tests__/` — extend the existing route tests minimally: for ingest and trending auto-refresh routes (the two richest mappings), assert a ledger line lands with the right status. Other routes: mapping logic is trivial passthrough; covered by the shared wrapper's Task 1 tests.

**Notes:** several routes stream NDJSON/SSE (feed refresh, deep spark) — read the route first; wrap the inner orchestrator call, not the stream plumbing. If a route uses `jsonSkillRoute`, wrap inside its handler callback. Trigger is `"user"` at every route (the scheduler in Task 7 passes `"schedule"` from its own call sites).

- [ ] **Step 1:** Write the two failing route tests (ingest draft → degraded ledger record; auto-refresh backoff → skipped record).
- [ ] **Step 2:** Run them — expect FAIL.
- [ ] **Step 3:** Instrument all listed routes.
- [ ] **Step 4:** `npx vitest run src/app/api` — expect PASS.
- [ ] **Step 5:** Commit: `feat(runs): ledger instrumentation at every orchestrator call site`

---

### Task 4: Changeset revert telemetry + acceptance summary

**Files:**
- Modify: `src/lib/events/types.ts` — add `| { type: "changeset_revert"; changesetId: string; skill: string }`. Remove the never-emitted `ingest_undo` member **only after** `grep -rn "ingest_undo" src` shows no other references.
- Modify: `src/app/api/vault/changeset/route.ts` — on `action === "revert"` success: `await logEvent(storage, { type: "changeset_revert", changesetId: changeset.id, skill: (changeset as Changeset & {skill?: string}).skill ?? (await loadChangeset(storage, changeset.id))?.skill ?? "unknown" })`.
- Modify: `src/lib/skills/ingest.ts` `undoIngest` — after `appendLog`, `await logEvent(storage, { type: "changeset_revert", changesetId, skill: "ingest" }, opts.now)`.
- Create: `src/lib/runs/acceptance.ts`
- Test: `src/lib/runs/__tests__/acceptance.test.ts`, extend `src/lib/vault/__tests__/` or route tests for the emit paths.

**Interfaces (Task 5 relies on these):**
```ts
export interface SkillAcceptance {
  skill: string
  applied: number
  reverted: number
  /** applied === 0 → null */
  acceptRate: number | null
  /** all-time usage cost of this changeset-producer's LLM skills; null when unmapped */
  totalCostUsd: number | null
  /** totalCostUsd / (applied - reverted); null when denominator ≤ 0 or cost unmapped */
  costPerAcceptedUsd: number | null
}
export function summarizeAcceptance(
  changesets: Array<{ id: string; skill: string }>,
  revertedIds: Set<string>,
  usageRecords: Array<{ skill: string; costUsd: number | null }>,
): SkillAcceptance[]
```
Skill→usage-name map (exact, from `grep 'name: "' src/lib/skills src/lib/spark`):
```ts
const USAGE_SKILLS: Record<string, string[]> = {
  ingest: ["ingest"],
  enrich: ["enrich"],
  lint: ["lint-screen", "lint-judge"],
  "memory-consolidation": ["memory-consolidation"],
  "spark-deep": ["spark-bottleneck", "spark-ideation", "spark-scoop-terms", "spark-scoop-verdict", "spark-audit"],
}
```
Unmapped changeset skills get `totalCostUsd: null`. Sort output by `applied` desc.

**Server aggregation (also this task):** extend `src/app/api/usage/route.ts` GET:
- list `.scispark/changesets/` → parse each `{id, skill}` (skip corrupt).
- reverted ids = `changeset_revert` events (from `readRecentEvents(storage, { limit: 5000 })`, filter by type) **∪** ingest `log.md` undo entries — reuse the regex from `src/lib/wiki/review-queue.ts:156-159` (`/\]\s+undo\s+\|\s+(\S+)/g`); extract that into an exported helper `parseUndoneChangesetIds(logMd: string): Set<string>` in `review-queue.ts` and call it from both places.
- response gains `acceptance: SkillAcceptance[]` and `recentRuns: OrchestratorRunRecord[]` (from `readLedger(vault, { limit: 20 })`).
- Update `UsageResponse` in `src/lib/llm/usage-client.ts` accordingly (type-only imports keep browser purity).

- [ ] **Step 1:** Failing tests: `summarizeAcceptance` — ingest 3 applied 1 reverted → acceptRate 2/3, costPerAccepted = ingestUsageCost/2; unmapped skill → null costs; zero applied → null rate. `undoIngest` emits `changeset_revert`. Revert route emits with skill resolved from the audit record. `parseUndoneChangesetIds` round-trip. Usage route test: response contains `acceptance` + `recentRuns` and still never echoes key material.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement all pieces.
- [ ] **Step 4:** `npx vitest run src/lib/runs src/lib/events src/lib/skills/__tests__ src/app/api` — expect PASS.
- [ ] **Step 5:** Commit: `feat(usage): changeset revert telemetry + per-skill acceptance / cost-per-accepted-change`

---

### Task 5: Spend panel — acceptance table + recent runs

**Files:**
- Modify: `src/components/settings/SpendPanel.tsx`
- Test: `src/components/settings/__tests__/` (follow the existing `react-dom/server` render-test pattern used for FieldPanelView's surveyError line)

**UI (token classes only, match the existing table styling in the file):**
- New section "Changeset acceptance" after "Today by skill": table `skill | applied | reverted | accept | $/accepted`; accept as percent (`—` when null); `$/accepted` via the existing `usd()` helper (`—` when null). Empty state: "No changesets yet."
- New section "Recent runs": last 10 of `recentRuns` — `orchestrator · status · reason? · cost? · relative time`; status colored `text-red-600` for failed, `text-muted-text` for skipped, default otherwise. Empty state: "No runs recorded yet."

- [ ] **Step 1:** Failing render tests: given a stubbed fetch payload with one acceptance row and one failed run, rendered HTML contains the accept percentage and the failure reason.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run src/components` — PASS.
- [ ] **Step 5:** Commit: `feat(spend-panel): acceptance + recent-runs sections`

---

### Task 6: Lint write-time dedupe + post-ingest scoped lint

**Files:**
- Modify: `src/lib/lint/run.ts`
- Modify: `src/lib/skills/ingest.ts` (post-apply hook)
- Test: extend `src/lib/lint/__tests__/run.test.ts` and `src/lib/skills/__tests__/ingest.test.ts`

**Interfaces:**
- `findingIdentity(f: Pick<LintFinding, "lintKind" | "fixTarget" | "pages">): string` — `` `${lintKind}|${fixTarget ?? ""}|${[...pages].sort().join(",")}` `` (exported for tests).
- In `runLintDeterministic` (and the LLM path's finding-write in `runLintLlm`): before `writeFindingsAsReviews`, drop findings whose identity matches an existing **open** review item (`listReviews` — archived items don't come back from it, so dismissed findings can legitimately reappear; accepted v1 behavior, note it in a comment).
- `runPostIngestLint(storage: VaultStorage, touchedPageIds: string[], opts?: { now?: () => Date }): Promise<{ findings: LintFinding[]; reviewIds: string[] }>` — runs `runDeterministicChecks` over a fresh `loadBundle`, filters to findings whose `pages` intersect `touchedPageIds`, **excludes `lintKind === "index-drift"`** (ingest just rebuilt the index), dedupes as above, writes review items. No `lint_run` event (it's a verify step of the ingest run, not a lint run).
- In `ingestSkill.run`, after `appendLog(...)` (`src/lib/skills/ingest.ts:553`): derive `touched` = each change path ending `.md` under the wiki, mapped to page id (strip trailing `.md`), and
```ts
try {
  await runPostIngestLint(storage, touched, { now: () => new Date(nowIso) })
} catch (err) {
  ctx.log(`post-ingest lint failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
}
```

- [ ] **Step 1:** Failing tests: (a) two consecutive `runLintDeterministic` runs on a vault with one broken link produce ONE open review item; (b) `runPostIngestLint` on a changeset that introduced a broken wikilink files a scoped finding, and files nothing for a pre-existing broken link on an untouched page; (c) index-drift never appears from the post-ingest path; (d) ingest end-to-end: a generation containing `[[does-not-exist]]` → inbox contains a `lint-finding` item after ingest returns ok; a storage that throws during lint doesn't fail the ingest.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run src/lib/lint src/lib/skills` — PASS.
- [ ] **Step 5:** Commit: `feat(lint): write-time dedupe + post-ingest scoped verify step`

---

### Task 7: Scheduler heartbeat

**Files:**
- Create: `src/lib/scheduler/heartbeat.ts`
- Create: `src/instrumentation.ts`
- Test: `src/lib/scheduler/__tests__/heartbeat.test.ts`

**Interfaces:**
```ts
export interface HeartbeatDeps {
  storage: VaultStorage
  searchFn: SearchFn
  countFn?: CountFn
  groupFn?: GroupFn
  now?: () => Date
}
/** One tick: runs each job in sequence, each in its own try/catch + withLedger(trigger:"schedule"). Never throws. */
export async function runHeartbeatTick(deps: HeartbeatDeps): Promise<void>
/** Interval starter with globalThis singleton guard. Returns a stop function. */
export function startHeartbeat(opts?: { intervalMs?: number }): () => void
```
Jobs inside `runHeartbeatTick`, in order (each wrapped in `withLedger` with `trigger: "schedule"`, mapping statuses exactly as the corresponding route does in Task 3):
1. **trending**: `maybeAutoRefreshTrending` (Task 2's gates make this safe: cadence-stale check + failure backoff). Statuses map as in Task 3.
2. **consolidation**: `runConsolidation(storage, { settings })` — self-gated on ≥25 events; `skipped` when not due.
3. **deterministic lint** (free): gate = last ledger record with `orchestrator === "lint-deterministic"` (any trigger) is older than 24h (or absent) → `runLintDeterministic`; else record nothing (skip silently — don't spam the ledger with hourly "skipped" lint rows; add a code comment saying so).

`startHeartbeat`:
- Kill switch: `if (process.env.SCISPARK_SCHEDULER === "off") return () => {}`.
- Singleton: `const KEY = Symbol.for("scispark.heartbeat")` on `globalThis`; if already set, return existing stop fn (dev HMR / double-register guard).
- Interval default 15 min + one initial tick after a 60s `setTimeout` (let the server finish booting). Both timers `.unref?.()`.
- Deps built lazily per tick inside a try/catch: `getServerVault()`, `nodeSearchFn()`, `nodeCountFn()`, `nodeGroupFn()`, `loadSettings(vault)` (see `src/app/api/skills/trending/auto-refresh/route.ts:19-22` for the exact dep construction to mirror).

`src/instrumentation.ts`:
```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NEXT_PHASE === "phase-production-build") return
  const { startHeartbeat } = await import("./lib/scheduler/heartbeat")
  startHeartbeat()
}
```
(Next.js App Router picks up `src/instrumentation.ts` automatically; no config flag needed on Next 15+/16.)

**Test note:** test `runHeartbeatTick` directly with injected deps/`now` (no fake timers): job 2 throw doesn't prevent job 3; lint gated off when a fresh `lint-deterministic` ledger record exists, runs when 25h old; every executed job leaves a `trigger: "schedule"` ledger record. Test `startHeartbeat` singleton: two calls → same stop fn identity; env kill switch returns noop without touching globalThis.

- [ ] **Step 1:** Failing tests as above. **Step 2:** Run — FAIL. **Step 3:** Implement both files. **Step 4:** `npx vitest run src/lib/scheduler` — PASS; also `npx vitest run src` browser-purity + full-suite spot check that `instrumentation.ts` breaks nothing.
- [ ] **Step 5:** Commit: `feat(scheduler): server heartbeat — trending/consolidation/lint on a real interval (SCISPARK_SCHEDULER=off to disable)`

---

### Task 8: Projective budget check

**Files:**
- Modify: `src/lib/llm/pricing.ts` — add:
```ts
/** Conservative pre-call cost projection: prompt chars/4 as input tokens + full
 * maxTokens (default 1024) as output. Unknown model → null (caller treats as 0,
 * preserving today's reactive behavior for unpriced models). */
export function estimateNextCallUsd(model: string, req: { messages: Array<{ content: string }>; maxTokens?: number }): number | null
```
- Modify: `src/lib/skills/runner.ts:76` and `:95` — `await checkBudget(meter, settings, estimateNextCallUsd(model, req) ?? 0)` (note: `model` must be resolved BEFORE the check now; reorder the two lines).
- Test: `src/lib/llm/__tests__/pricing.test.ts` + extend the runner budget test.

- [ ] **Step 1:** Failing tests: estimate math against a known PRICES entry; unknown model → null; runner blocks a call whose projection crosses the budget even though spent-so-far is under it (previously passed), still allows when projection fits.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run src/lib/llm src/lib/skills` — PASS.
- [ ] **Step 5:** Commit: `feat(budget): projective pre-call budget check (spent + estimated next call)`

---

### Task 9: Full verification + docs

- [ ] **Step 1:** `npx vitest run` — full suite green (baseline 1550+; zero new failures).
- [ ] **Step 2:** `npx tsc --noEmit` — clean. `npm run lint` — no NEW errors/warnings vs the 8/6 baseline. `npm run build` — clean (proves `instrumentation.ts` builds).
- [ ] **Step 3:** Manual smoke with the dev server: start it, confirm one heartbeat boot log; hit `/api/usage` and confirm `acceptance`/`recentRuns` in the JSON; open the settings modal spend panel.
- [ ] **Step 4:** Docs: add a "Loop runtime" subsection to `docs/design/04-agent-harness.md` (ledger, scheduler, backoff, acceptance metric, projective budget — one paragraph each); append the status block to this plan file.
- [ ] **Step 5:** Commit: `docs(harness): loop-runtime section + plan status block`

## Status (2026-07-19)

**All 9 tasks complete.** Commit range `4bb47a7..a6f7e7d` on `loop/loop-engineering-hardening` (10 commits: `a097440` ledger, `220134c`+`a325b02` trending backoff, `36b6519` ledger instrumentation, `a536142` acceptance telemetry, `a9d148d` spend-panel UI, `ad542bc` lint dedupe + post-ingest, `ce84e84`+`11362af` scheduler heartbeat, `a6f7e7d` projective budget), plus this task's docs/lint-config commit. Task 9 verification: `npx vitest run` — 168 test files, 1656 passed / 15 skipped, zero failures. `npx tsc --noEmit` — clean (no errors at all; the previously-documented stale `.next/types/validator.ts` reference had already cleared from a recent build, ahead of Task 9 even checking). `npm run lint` — fixed by adding `.claude/worktrees/**` to `eslint.config.mjs`'s `globalIgnores`; before the fix, a sibling session's worktree `.next` artifacts drowned the run in 1349 errors / 23187 warnings, after the fix it reads 8 errors / 5 warnings, all pre-existing in fork-era mock files (chat/notes/hooks/projects/spark-page act-on-mount lint rules, plus two unrelated unused-import test warnings) — zero findings in any file this branch touched. `npm run build` — succeeds; `instrumentation.ts` compiles into `.next/server/instrumentation.js`, confirming the heartbeat wiring builds cleanly.

**Two in-flight fix loops** (both already resolved and merged into the task commits above, not new work here):
- **Task 2** (trending backoff): the first pass wrote the failure marker without a try/catch around that write; if the marker write itself threw (e.g. alongside whatever made the dashboard refresh fail), the exception would propagate out of a function both call sites treat as fire-and-forget. Fixed in `a325b02` by wrapping the marker write in its own try/catch (tolerating a write failure as best-effort bookkeeping) and adding a compound-failure regression test.
- **Task 7** (scheduler heartbeat): the first pass had no protection against two ticks running concurrently. Because a tick can run long (120s LLM timeouts, arXiv/OpenAlex retry/backoff chains, a multi-field trending survey), a slow tick could still be in flight when the next 15-minute interval fired, and both would observe the same "due" cadence/backoff/event-count gates before either had written results — a real double-spend risk. Fixed in `11362af` with a module-scope `tickInFlight` skip-not-queue guard (checked and set before the first await) plus a `vi.waitFor`-based regression test asserting exactly 3 ledger records land, not 6.

**Accepted design extension (Task 4):** `summarizeAcceptance()` surfaces a zero-applied acceptance row for any `USAGE_SKILLS`-mapped skill that has real LLM spend but no applied changeset at all (e.g. a Deep Spark run that spent across bottleneck/ideation/scoop/audit calls but exited honestly via `do_not_generate` before ever assembling an idea page). This goes beyond the original per-skill-with-changesets framing in the brief; the controller adjudicated it as an accepted extension because the alternative — silently dropping that spend from the acceptance view — would hide exactly the "spent, nothing accepted" signal the metric exists to surface. Tell Tong: this is deliberate product behavior, not a bug, if a zero-applied row shows up in the spend panel.

**Open minors** (none blocking merge; carried forward from `.superpowers/sdd/progress.md`'s per-task review notes):
- Task 1 (ledger): `readLedger`'s `slice(-limit)` returns everything when `limit` is 0 (untriggered in practice — no caller passes 0); no dedicated concurrency regression test for the write-queue (the pattern is copied verbatim from `events/log.ts`, whose own test covers the same mutex).
- Task 2 (trending backoff): no lock around the marker's read-decide-write sequence for concurrent callers (benign — worst case is one extra redundant attempt, not a correctness bug); `trending/client.ts`'s exported return-type union was stale until folded into Task 3's instrumentation pass.
- Task 4 (acceptance): the `"unknown"` skill-name fallback branch (when a revert event's changeset can't be resolved to a skill) is untested; `readRecentEvents`'s 5000-record cap means very old reverts can age out of the acceptance window on an extremely active vault — a v1 limitation, candidate for a type-filtered event read if it ever matters.
- Task 5 (spend panel): the `$/accepted` cell falls back to showing the raw total cost when `acceptedCount <= 0`, and that fallback has no visual disambiguator yet (a tooltip or muted styling would make "this is total spend, not per-accepted-change" clearer at a glance); `relativeTime` renders "NaNy ago" on an unparseable timestamp instead of a friendlier fallback; round-at-tier-boundary time formatting is under-covered by tests.
- Task 6 (lint dedupe): no regression test for double-run dedupe specifically on the LLM lint path (only the deterministic and post-ingest paths are directly tested for it, though they share the same `dropFindingsAlreadyOpen` helper); `findingIdentity`'s delimiter (`|`) could theoretically collide with a slug containing that character, closed in practice by `isValidSlug`'s invariants but worth a code comment if that constraint ever loosens.
- Task 7 (heartbeat): `loadSettings` is called twice per tick (once each for the trending and consolidation jobs) rather than once and shared; `readFailureReason` is duplicated between the heartbeat and the auto-refresh route rather than sharing one exported helper; the 24h lint gate is a strict boundary with no slack, a minor nitpick not a bug.
- Task 8 (projective budget): the claim that budget-exceeded errors take precedence over missing-key errors is asserted by code comment but not covered by a dedicated test (pre-existing gap, not introduced here); the "conservative" chars/4 token estimate is optimistic for token-dense text (CJK, code, dense math) — inherited from the task spec's own formula, not a Task 8 regression; structured-output calls don't project the schema's own token overhead, also spec-inherited.
