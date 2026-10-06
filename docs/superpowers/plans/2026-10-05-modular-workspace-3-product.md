# Modular Workspace Product Integration Implementation Plan


**Current tracking (consolidated final fix):** Checked items record reviewed implementation and
executed offline/fixture checks, including explicit unsupported outcomes; they
are not live/OS/scientific passes. Mixed steps below remain unchecked where their
actual worker/install/CLI or final-review clause is open. The
[current requirement/evidence map](../../testing/2026-10-05-modular-workspace.md)
and [chronological R1–R79 rulings/costs](../../testing/artifacts/modular-workspace-2026-10-05/decisions.md)
govern current scope. F1–F6 and M1–M3 from the single broad review are implemented in the
[consolidated fix report](../../testing/artifacts/modular-workspace-2026-10-05/final-fix/final-fix-report.md).
The single scoped re-review passed on `fbb86dd093dee2af9fb3aaf9b452e4aa3244a8ce`; see the [review/finalization summary](../../testing/artifacts/modular-workspace-2026-10-05/final-fix/review-summary.md). The subsequent amend is documentation/evidence only; real execution gates remain open.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make native and imported tools usable through one coherent Tools/Sparky experience and verify the complete research cycle.

**Architecture:** Register existing orchestrators through native adapters, retaining their evidence/financial records. Route intent against enabled capabilities, persist the user's tool choice, and render shared run/artifact records through existing chat, paper and history components.

**Tech Stack:** Existing Next.js/React semantic UI, Zod contracts, controlled workflow runtime from Parts 1–2, Vitest, disposable-vault Playwright.

**Spec:** [Design](../specs/2026-10-05-modular-workspace-design.md); [master plan](2026-10-05-modular-workspace.md). Requires Tasks 1–13.

## Global Constraints

Master constraints apply. "Built-in tools and imported tools are equal
candidates." "Select one top-level tool per run." "Start with the core
workspace only." Existing history, evidence, wiki content and undo records
survive migration and tool removal. Preserve `design.md` and the user's concise
copy, rounded-box and streaming requirements.

## Review Focus

Direct endpoints bypassing disabled tools (14); ambiguous intent and stale
choice options (16); result loss after disabling/removal (17); unsupported
scientific claims (18); actual browser/server interruption and profile crossover
(19). The following tasks explicitly test these cases.

---

### Task 14: Wrap native workflows and guard their entry points

**Create:** `src/lib/extensions/native-adapters.ts`, `src/lib/extensions/require-tool.ts`, `src/lib/extensions/__tests__/native-adapters.test.ts`.
**Modify:** `src/lib/skills/runner.ts`, `src/lib/review/budget.ts`, `src/lib/review/local-budget.ts`, `src/lib/review/coordinator.ts`, `src/lib/spark/deep.ts`, `src/lib/scheduler/heartbeat.ts`, and the execution routes listed below. Reference `src/lib/trending/dashboard.ts`, `src/lib/skills/research-search.ts`, `src/lib/spark/quick.ts`, `src/lib/review/store.ts`.

**Interfaces:** `registerNativeAdapters(): void`; `requireEnabledTool(ctx,key:ToolKey): Promise<ToolManifest>`; `executeNativeTool(ctx,run,io): Promise<void>`. Add optional `persistence: "apply"|"propose"` to `DeepSparkArgs`, defaulting to existing behavior for legacy callers; new workflow invocation always uses `propose`; Task 6 applies authorized wiki intent. Extend `DeepSparkResult` with an optional validated proposed changeset. Add Task-3 attempt-scope hooks around native model dispatch; capture model overrides without rewriting profile settings.

| Tool | Native implementation | Execution routes to bind/guard |
| --- | --- | --- |
| Trending | `runTrendingBoard` | `src/app/api/skills/trending/refresh/route.ts`, `src/app/api/skills/trending/auto-refresh/route.ts` |
| Find Papers | `runResearchSearch` | `src/app/api/skills/research-search/route.ts`, search mode in `src/app/api/skills/chat/route.ts` |
| Deep Review | `createReview` + `actOnReview` | `src/app/api/reviews/route.ts`, mutating start/resume actions in `src/app/api/reviews/[id]/route.ts` |
| Idea Spark | `runQuickSpark` + `runDeepSpark` | `src/app/api/skills/spark/quick/route.ts`, `src/app/api/skills/spark/deep/route.ts`, `src/app/api/skills/spark/estimate/route.ts` |

- [x] First grep each implementation and route's callers; preserve live internal retrieval helpers and saved-result readers. Test legacy migration, direct disabled endpoints, scheduler skipping disabled Trending, core feed/digest independence, and native/imported accounting:
  ```ts
  expect((await callDisabledSearchRoute()).status).toBe(409)
  expect(modelCalls).toBe(0)
  expect(await runCoreFeedWithOptionalToolsDisabled()).toBeDefined()
  expect(workflowUsage.costUsd).toBe(nativeLedger.costUsd) // not twice that value
  expect(await wikiWasWrittenForOutputsOnlySpark()).toBe(false)
  ```
- [x] Run `npx vitest run src/lib/extensions/__tests__/native-adapters.test.ts`; expect new assertions to fail.
- [x] Register four adapters using existing orchestrators and result schemas. Convert the listed legacy execution routes to the same coordinator, adapting their existing progress/result transport so existing pages also get durable runs; do not leave a second untracked execution path. Keep each legacy review's ID, checkpoints, report versions, financial ledger and holds; the workflow envelope points to that native ID. Existing ledgers own billing while workflow counters enforce aggregate limits. Hook all native provider attempts, including grounding/repair, before dispatch; avoid nested reservation locks. New explicit tool invocation may construct its complete default brief and start once; missing scope/settings still requires input. Existing saved-brief editing/read paths remain available without creating a run.
- [x] For native steps, reuse fine-grained durable checkpoints where available; an opaque interrupted native call stays uncertain rather than being restarted from scratch. Keep scheduler heartbeat for core functions and add enablement checks only around optional work. Run native tests, review durability/budget and scheduler suites, then master verification.
- [x] Commit `feat: register native research workflows as optional tools`.

**Execution clarification:** R6: Workflow DeepSpark always returns a validated proposal. Any authorized write is applied through the journaled Task-6 save mechanism with a stable preallocated changeset ID. Keep legacy apply defaults only for remaining authorized non-workflow callers. R10: Task 6 owns the durable server-side authorized save step and coordinator completion trigger. Task 10/14 submit validated proposals or completed artifacts to it. outputs_only never automatically writes. Task 17 only observes or requests an explicit save.

### Task 15: Tools library, imports, setup and profile controls

**Create:** `src/app/tools/page.tsx`, `src/components/tools/ToolsLibrary.tsx`, `src/components/tools/ToolCard.tsx`, `src/components/tools/ImportToolDialog.tsx`, `src/components/tools/ToolSettings.tsx`, `src/lib/extensions/client.ts`, `src/app/api/tools/imports/route.ts`, `src/app/api/tools/imports/[id]/route.ts`, `src/components/tools/__tests__/ToolsLibrary.test.tsx`.
**Modify:** `src/components/layout/Sidebar.tsx`, `src/components/settings/LocalEngineConnection.tsx`, `src/lib/__tests__/browser-purity.test.ts`.

**Interfaces:** `listToolsRemote`, `previewToolImportRemote`, `confirmToolImportRemote`, `updateToolBindingRemote`, `discoverAgentSkillsRemote`, `updateToolVersionRemote` are authenticated wrappers over Tasks 5/7/12/13. Add import endpoints for staged preview, explicit confirmation, environment preparation and state inspection; installation status uses a durable setup record, not component state. React components receive redacted DTOs only.

- [x] Test an empty profile's core navigation, catalog addition, pinning, GitHub/local import, unavailable dependencies, manual update preview and existing-agent consent:
  ```tsx
  expect(screen.queryByRole("link", { name: "Trending" })).toBeNull()
  await user.click(screen.getByRole("button", { name: "Find installed skills" }))
  expect(discoveryRequest).not.toHaveBeenCalled() // root/permission choice still pending
  await consentToCodexRoot()
  expect(discoveryRequest).toHaveBeenCalledTimes(1)
  ```
  Test doubles use fixture DTOs; local import requires a user-selected upload or explicit folder path, never a silently inferred home scan.
- [x] Run `npx vitest run src/components/tools/__tests__/ToolsLibrary.test.tsx`; expect failure.
- [x] Show Installed/Catalog views and Add tools choices (GitHub, local files/folder, installed agents). Keep cards rounded boxes and action buttons pills. Add a Tools sidebar link; pins render from enabled profile bindings. Reuse the model picker for per-tool overrides and expose allowance controls under Advanced. Offer installed-agent discovery after connection without scanning automatically; retain dismissal per profile. Disabling an active tool shows its running task and explicit finish/cancel choices. Local folder input is handled only by the authenticated local runtime; folder/ZIP uploads use Task-7 limits.
- [x] Run focused/master checks. Browser-check desktop/mobile wrapping, keyboard/focus behavior, theme tokens and concise setup errors. Verify a model setting change never mutates an active run and keys are never returned to the UI.
- [x] Commit `feat: add the profile-specific Tools library`.

**Execution clarification:** R9: Task 12 defines strict grant/revoke/discover/stage action DTOs. Task 13 defines binding/update/rollback/removal DTOs with operation IDs and active-run disposition finish or cancel; an unspecified disposition returns decision-required. Task 15 consumes these same schemas.

### Task 16: Intent routing and the overlapping-tool chooser

**Create:** `src/lib/extensions/intent.ts`, `src/app/api/tools/choices/[id]/route.ts`, `src/components/chat/ToolChoiceBlock.tsx`, `src/lib/extensions/__tests__/intent.test.ts`.
**Modify:** `src/lib/extensions/contracts.ts`, `src/lib/extensions/client.ts`, `src/lib/chat/orchestrator.ts`, `src/lib/chat/blocks.ts`, `src/lib/chat/session.ts`, `src/components/chat/ChatWorkspace.tsx`, `src/components/chat/MessageList.tsx`, `src/components/chat/__tests__/chat-components.test.tsx`, `src/lib/server/__tests__/workflow-api.test.ts`.

**Interfaces:** `resolveToolIntent(ctx,input:ToolIntentInput): Promise<ToolIntentResolution>`; input includes question, explicit tool ref if any, conversation/current-paper context, and an optional existing run reference. Resolution is `chat|clarify|run|choose|add-tool` with appropriate refs. Define public intent schemas in extension contracts. `chooseTool(ctx,choiceId:string,tool:ToolRef,operationId:string): Promise<ToolRun>` revalidates eligibility and consumes a saved choice once; expose it via POST `/api/tools/choices/[id]` and `chooseToolRemote`. Top-level choices precede run creation, so they cannot require a run ID. Persist them under `.scispark/tools/choices/<uuid>.json`. Define `tool-choice` and `tool-run` ChatBlock variants. Derive write intent from the user's request/save action, never package instructions.

- [x] Test explicit choice, one match, multiple matches, unclear request, no enabled match, follow-up retention, ordinary paper explanation, renamed tools, stale/disabled choices and adversarial skill descriptions:
  ```ts
  expect(await resolveToolIntent(ctx, ambiguousReview)).toMatchObject({ kind: "choose" })
  expect(await resolveToolIntent(ctx, namedReview)).toMatchObject({ kind: "run", tool: importedRef })
  expect(await resolveToolIntent(ctx, explainCurrentPaper)).toMatchObject({ kind: "chat" })
  expect(workflowStarts).toBe(0) // classification/choice alone never starts candidates
  ```
- [x] Add a server race test: selecting two different tools for the same choice produces one run and one 409; retrying the winning selection returns that run. A supporting-skill choice resumes its existing root instead of starting a second top-level run.
- [x] Run `npx vitest run src/lib/extensions/__tests__/intent.test.ts src/components/chat/__tests__/chat-components.test.tsx`; expect new cases to fail.
- [x] Resolve explicit names/existing run context deterministically; use at most one bounded, metered structured intent decision when semantic interpretation is needed. Persist that decision under the existing chat operation ID, so a duplicate send or reload does not repeat classification or tool start. Classification may reference only enabled, ready tool IDs and cannot authorize arbitrary commands. Unclear intent asks; contextual relevance alone does not run a tool. An empty registry leaves ordinary core chat unchanged. Persist the request and choice in chat so reload retains it; choosing submits one idempotent start. Show name/source/one-line distinction, with no built-in preference. Reject multi-selection at the server. A disabled/missing candidate refreshes the chooser without silently selecting another.
- [x] Replace fixed optional mode entries with enabled capabilities while keeping core discussion, paper context and selection-to-Sparky behavior. Preserve legacy session mode parsing and translate old search/review actions through their native adapters. Run focused/master checks and existing paper-context/selection/chat browser tests.
- [x] Commit `feat: route Sparky requests through enabled tool choices`.

**Execution clarification:** R5: Semantic intent classification has a chat-operation-keyed persisted metered attempt, using existing API daily/CLI controls. It precedes the root run and is not charged a second time to root counters. Preserve unknown outcome and the saved decision to prevent duplicate dispatch. R8: Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. Additional Create: src/lib/extensions/choice-store.ts and src/lib/extensions/classification-attempt.ts, plus focused tests for persisted decisions/unknown outcomes. These own private choice and chat-operation accounting records.

### Task 17: Shared run view, artifacts and History

**Create:** `src/app/tools/runs/[id]/page.tsx`, `src/components/tools/ToolRunView.tsx`, `src/components/tools/ToolArtifacts.tsx`, `src/components/chat/ToolRunBlock.tsx`, `src/components/tools/__tests__/ToolRunView.test.tsx`.
**Modify:** `src/components/history/HistoryPageClient.tsx`, `src/components/chat/MessageList.tsx`, `src/lib/ui/nav-history.ts`, `src/lib/workflows/contracts.ts`, `src/lib/workflows/client.ts`, `src/app/api/tools/runs/[id]/actions/route.ts`.

**Interfaces:** `ToolRunView({runId:string})`, `ToolRunBlock({runId:string})`, `ToolArtifacts({runId,artifacts})` consume the same workflow client. History adds a Runs view to the existing Conversations/Changes entry point; a conversation contains links to its runs and each run links back. A run started in Tools has its own history entry without creating a fabricated chat transcript.

Add an idempotent run action `{action:"resolve-uncertain", operationId, stepId,
resolution:"retry"|"stop"}`. Retry records the acknowledgement, conservatively
accounts for uncertain prior usage and reserves a new attempt; it does not erase
the old attempt. Reconcile completed wiki writes by their changeset ID rather
than offering a blind retry. Supporting-skill choices use a separate
`{action:"choose-helper", operationId, choiceId, tool:ToolRef}` action validated
against the parent graph; both actions are scoped to that existing run.

- [x] Test two observers, detach/reconnect, duplicate cursors, partial Markdown, terminal flush, disabled/uninstalled tool history, unknown usage and profile change during streaming:
  ```tsx
  expect(startRunRemote).not.toHaveBeenCalled() // opening an existing run is read-only
  expect(screen.getByRole("button", { name: "Continue" })).toBeVisible()
  expect(screen.getByText("3 calls used")).toBeVisible()
  expect(screen.queryByText(otherProfileText)).toBeNull()
  ```
- [x] Run `npx vitest run src/components/tools/__tests__/ToolRunView.test.tsx`; expect failure.
- [x] Render brief phase/status, streaming Markdown and reduced-motion-aware loading cues with existing ChatMarkdown/StreamingReply. Keep diagnostics behind a disclosure; distinguish waiting, reached limit, uncertain action, failure and completion. Continue extends the same run/counters; cancellation is explicit and idempotent. Present paper/report/BibTeX artifacts through existing components and profile-bound downloads. Explicit Add to wiki uses Task 6; prior `update_wiki` intent applies once automatically. Clear old profile observers/UI before showing a new profile.
- [x] Run focused/master checks and production build; capture desktop/mobile run and chooser screens. Verify save/undo, citations, download headers and navigation back to a running job.
- [x] Commit `feat: unify workflow progress and results in History`.

**Execution clarification:** R7: Coordinator owns typed idempotent action transitions and journal records; the host owns persisted helper continuations. Task 17 extends coordinator/journal/agent/usage services with resolveUncertain and chooseHelper, backend race/crash tests, then routes/UI. Routes never invoke adapters directly. R10: Task 6 owns the durable server-side authorized save step and coordinator completion trigger. Task 10/14 submit validated proposals or completed artifacts to it. outputs_only never automatically writes. Task 17 only observes or requests an explicit save. Additional Modify: src/lib/workflows/coordinator.ts, journal.ts, agent.ts and usage.ts. Add src/lib/workflows/__tests__/actions.test.ts for concurrent retry/helper resolution and crash recovery.

### Task 18: Imported literature-review workflow and scientific checks

**Create:** `src/lib/extensions/catalog/literature-review.ts`, `src/lib/extensions/catalog/literature-review.lock.json`, `src/lib/extensions/__tests__/literature-review.test.ts`, `src/lib/extensions/__tests__/live-workflow.test.ts`, `e2e/fixtures/tools/literature-review.ts`.
**Modify:** `src/lib/extensions/native-catalog.ts`; extend Task-10 host actions only for requirements demonstrated by the pinned skill.

**Interfaces:** `literatureReviewCatalogEntry(): CatalogEntry`. Resolve the pinned skill's actual supporting dependency closure, including OpenCite, writing, self-review, and final prose pass as required by its selected mode. Helpers remain internal graph nodes with one root run; optional GitHub orchestration is not required for the local review. Add a journaled `parallel` host action with bounded fan-out of two supporting skill nodes when the selected protocol explicitly requests parallel strands; all reservations still use the parent ledger.

- [x] Fixture a two-strand, six-paper corpus with full text, abstract-only evidence, contradictory findings, a missing source and an unsupported requested comparison:
  ```ts
  expect(report.sourceIds.every(id => corpusIds.includes(id))).toBe(true)
  expect(report.unsupportedComparisons).toContain("clinical performance")
  expect(helperRuns.every(r => r.rootRunId === rootId)).toBe(true)
  expect(await wikiWasWrittenWithoutUserIntent()).toBe(false)
  ```
  Add interruption after collection and verify no repeated acquisition/model attempt after recovery.
- [x] Run `npx vitest run src/lib/extensions/__tests__/literature-review.test.ts`; expect failure.
- [x] Adapt the pinned skill through the generic importer/host rather than rewriting the existing SciSpark review and relabelling it. Persist strand briefs, paper cards, source files, bibliography and cited synthesis as artifacts. Host adapters implement named helper invocation and managed command paths while preserving the skill's research procedure. Resolve missing requirements in setup and disclose unsupported operations. Pin the complete dependency graph and both model tiers.
- [x] Run the bounded fixture end to end through real coordinator and isolated command fixtures. Confirm the default allowance supports the chosen small review; if calibration changes a default, update the master contract/tests together and document the evidence. Implement `live-workflow.test.ts` with separate source-only and provider gates from Task 20, both off by default, and the same cumulative run ledger on retries. For an authorized live run, sample every claim in this small test against its cited passage and verify coverage of the requested comparison. Never infer scientific success from a valid JSON schema or reviewer-model approval alone. Run focused/master checks.
- [x] Commit `feat: integrate an imported multi-skill literature review`.

**Execution clarification:** R4: Capture effective fast/strong model selections and role mapping in the run model snapshot, without credentials. Defaults inherit existing selected settings; per-tool tier overrides are explicit. Helpers use that snapshot. Never infer a provider change from package prose. R8: Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. R11: Run contracts capture immutable prepared environment/lock refs and non-secret connection configuration revisions. Task 9 resolves these, Task 13 retains them for active/recoverable runs. Real credentials stay server-side and may rotate without copying secrets into run state. Additional Modify: src/lib/workflows/agent.ts, host-tools.ts, adapters.ts and src/lib/extensions/import-contract.ts for typed parallel actions and deterministic child step IDs.

### Task 19: Production browser, migration and restart acceptance

**Create:** `e2e/tools-library.spec.ts`, `e2e/tool-choice.spec.ts`, `e2e/tool-background.spec.ts`, `e2e/tool-restart.spec.ts`, `e2e/tool-profile-isolation.spec.ts`, `e2e/tool-review.spec.ts`.
**Modify:** `e2e/fixtures/mock-llm-server.mjs`, `e2e/global-setup.ts`, `scripts/run-playwright.mjs`, `.github/workflows/ci.yml` only for isolated fixtures/evidence and required gates. Reference `e2e/review-restart.spec.ts` and `e2e/background-skills.spec.ts` patterns.

**Interfaces:** Fixtures expose deterministic action decisions and genuinely delayed text chunks; child command fixtures record invocation IDs in the disposable run root. Extend the runner with `SCISPARK_E2E_ARTIFACT_DIR` for copying screenshots and evidence before cleanup; only allow a user-selected output directory outside the disposable roots. No live-provider fallback exists in fixtures.

- [x] First write browser regressions: fresh/default and migrated profiles; GitHub/ZIP/folder/agent fixture import; chooser; leave/return; browser close/reopen; real dedicated-server kill/restart; allowance extension; manual version update during a run; profile switch; wiki save/undo; unavailable sandbox and provider.
  ```ts
  expect(await readInvocationCount(runDir, "review-synthesis")).toBe(1)
  await page.goto("/wiki")
  await reopenRun(page, runId)
  await expect(page.getByText("Completed", { exact: true })).toBeVisible()
  expect(await readInvocationCount(runDir, "review-synthesis")).toBe(1)
  ```
  Define helpers in the relevant spec using the fixture process log, not UI text as the source of execution counts.
- [x] Run `npm run e2e -- e2e/tools-library.spec.ts e2e/tool-choice.spec.ts e2e/tool-background.spec.ts e2e/tool-restart.spec.ts e2e/tool-profile-isolation.spec.ts e2e/tool-review.spec.ts`; expect new assertions to expose integration gaps.
- [x] Fix production integration defects in their owning modules. The restart test starts/kills only its own isolated production server; verify completed step hashes remain unchanged and an uncertain model action is never automatically repeated. Test the configured default empty vault as well as explicitly created profiles. A fresh setup has no automatic tool scan, installed tool execution, or optional scheduler call.
- [x] Run full type/lint/unit/build gates and the targeted production commands below, then existing core E2E. Exercise real sandbox probes on macOS/Linux/Windows where claimed supported. Keep actual platform failures/unavailable environments visible in the evidence table; fake probes cannot satisfy that gate. Retain the four master-plan screenshots and provider/isolation logs without secrets.
- [x] Commit `test: verify modular workflows across navigation and restarts`.

Production verification (do not use the human server/build):

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
SCISPARK_LIVE_GATE_DIST_DIR=.next-modular-e2e npm run build
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-modular-e2e SCISPARK_E2E_ARTIFACT_DIR=/tmp/scispark-modular-evidence npm run e2e -- e2e/tools-library.spec.ts e2e/tool-choice.spec.ts e2e/tool-background.spec.ts e2e/tool-restart.spec.ts e2e/tool-profile-isolation.spec.ts e2e/tool-review.spec.ts
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-modular-e2e npm run e2e -- e2e/paper-chat-context.spec.ts e2e/selection-sparky.spec.ts e2e/chat-markdown.spec.ts e2e/feed-background.spec.ts e2e/literature-review.spec.ts e2e/review-restart.spec.ts
```

Expected: all required offline tests pass; no new lint warnings; both production
builds succeed; the disposable browser suites pass; evidence paths are printed
before cleanup. Environment-gated paid tests remain skipped until authorized and
are reported separately, never counted as live acceptance.

### Task 20: Documentation, gates and review handoff

**Modify:** `README.md`, `docs/FEATURE_GUIDE.md`, `docs/superpowers/specs/2026-10-05-modular-workspace-design.md`, and the four plan files' checkboxes.
**Create:** `docs/testing/2026-10-05-modular-workspace.md`, `docs/testing/modular-workspace-live-check.md`.

**Deliverable:** One evidence report maps every spec requirement to its test/task,
with branch/task commits, baseline/final test counts, setup/platform support,
four screenshots, migration behavior and remaining live gates. The live-check
document specifies the disposable profile, exact pinned packages, requested
question, selected provider/model, allowance, output paths and authorization gate.

- [x] Verify all 20 task deliverables against the master coverage map and exact source callers. Retain any unverified requirement as an open gate; do not silently remove it from the spec.
- [x] Document local execution prerequisites, how to add/choose/update tools, discovery consent and recovery/usage controls. Keep technical evidence and internal test details out of default product copy. State actual engine/OS compatibility demonstrated by the gates, including additional setup requirements.
- [x] For a live check, require explicit environment gates `SCISPARK_TOOL_LIVE_APPROVED=1`, `SCISPARK_TOOL_LIVE_MODEL`, `SCISPARK_TOOL_LIVE_MAX_CALLS`, and `SCISPARK_TOOL_LIVE_MAX_USD` for API engines, plus a disposable `SCISPARK_TOOL_EVAL_ROOT`. Require `SCISPARK_TOOL_SOURCE_SMOKE=1` for the separate source-only case and prohibit model calls in that case. Both run through `npx vitest run src/lib/extensions/__tests__/live-workflow.test.ts`. Reject the normal user vault. Retain a cumulative ledger across retries; never write a real API key into fixtures, command strings, artifacts or commits. Use secure existing connections or in-memory environment bindings. A real OpenCite retrieval gate and a paid synthesis gate are distinct checks.
- [ ] Validate Markdown links and `git diff --check`. Reuse the just-completed full gate unless subsequent code changes justify rerunning it. Review the full branch for boundary escapes, duplicate billing/mutations, missing core behavior, unsupported compatibility claims and UI regressions.
- [x] Commit `docs: document the modular workspace and validation evidence`. Report the branch/commits, exact validation and remaining gates; leave publication/merge for the user's instruction.

**Execution clarification:** R8: Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. Update the existing docs/testing/2026-10-05-modular-workspace.md baseline file.

## Task20 handoff state

The Task20 local documentation/link/whitespace/artifact checks and task review are
complete at `96d0785d96ba19f662ca3d8b4a6148f84d24f434`. The single broad review
found F1–F6/M1–M3; the consolidated fix wave follows the 20 reviewed task commits.

- [x] Separate final whole-branch review of boundaries, billing/mutations, core behavior, engine/OS claims and deferred UI/readability minors.
- [x] One controller-owned scoped re-review of the consolidated fixes and evidence, passed on the code-reviewed commit; later amend is documentation/evidence only.
- [ ] Supported-host real worker/install/CLI/broker, real OpenCite/source and explicit provider/human-scientific checks. The Task18 six-paper26model+2command fixture is calibration only.

R56 migrates obsolete native browser setup while preserving downstream assertions;
R57 restores explicit brief approval/shared controls; R58 restricts generic native
admission and leaves only the validated server bridge for prepared native actions.
All rulings/costs and current native2/modular11/core6 scopes are preserved in evidence.
