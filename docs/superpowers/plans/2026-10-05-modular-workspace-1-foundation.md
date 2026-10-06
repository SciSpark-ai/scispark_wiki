# Modular Workspace Foundation Implementation Plan


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

**Goal:** Build a profile-bound, recoverable execution foundation that can be tested without installing external packages or making paid calls.

**Architecture:** Add strict public contracts and server-owned persistence next to existing skill jobs. Run admission captures profile/model/tool identity; a durable journal and usage ledger determine recovery independently of browser observers.

**Tech Stack:** Existing TypeScript, Zod, Next.js Node route handlers, filesystem storage, Vitest.

**Spec:** [Design](../specs/2026-10-05-modular-workspace-design.md); [master plan and shared contracts](2026-10-05-modular-workspace.md).

## Global Constraints

All master-plan constraints, limits, verification and commit rules apply.
"Other profiles remain separate." "Pausing, resuming, or restarting must
preserve cumulative usage." Existing providers and legacy run ledgers remain
authoritative for their existing work.

## Review Focus

Stale profiles (2/5); duplicate starts (4); response-loss recovery (3/4); duplicate
wiki writes (6); migration preserving existing data (2). Tests below own each case.

---

### Task 1: Contracts, private state and deterministic fixtures

**Files — create:** `src/lib/extensions/contracts.ts`, `src/lib/extensions/store.ts`, `src/lib/workflows/contracts.ts`, `src/lib/workflows/context.ts`, `src/lib/workflows/store.ts`, `src/lib/workflows/__tests__/fixtures.ts`, `src/lib/workflows/__tests__/store.test.ts`.
**Modify:** `src/lib/server/local-profiles.ts`; add public contract modules to `src/lib/__tests__/browser-purity.test.ts`'s `CLIENT_LIB_FILES`.

**Interfaces:** Implement master contracts; `getProfileRegistryRoot(env?: NodeJS.ProcessEnv): Promise<string>`; `getWorkflowContext(): Promise<WorkflowContext>`; `readRun(ctx, id): Promise<ToolRun|null>`; `writeRun(ctx, run): Promise<void>`; `appendEvent(ctx, id, event: RunEventInput): Promise<RunEvent>`; `listRunEvents(ctx,id,after:number): Promise<RunEvent[]>`; `readProfileTools(ctx): Promise<ProfileTools|null>`. Use UUID/digest validation before all path construction. Task-1 `workflowFixture()` returns `ctx`, `other`, `tool`, `request`, and a valid `run`, using two independent in-memory contexts; `dispose()` cleans any temporary roots used by filesystem variants.

- [x] Write `store.test.ts`, using the fixture contexts, with schema-rejection, round-trip, atomic replacement and event-order tests:
  ```ts
  expect(() => ToolRefSchema.parse({ ...tool.ref, digest: "../escape" })).toThrow()
  await writeRun(ctx, run)
  expect(await readRun(other, run.id)).toBeNull()
  expect((await listRunEvents(ctx, run.id, 1)).map(e => e.seq)).toEqual([2, 3])
  ```
- [x] Run `npx vitest run src/lib/workflows/__tests__/store.test.ts`; expect missing-contract/store failures.
- [x] Implement schemas, context resolution, and storage with existing exclusivity and atomic writes. UUIDs are storage keys; user titles/skill names are never paths. Keep Node imports out of public contracts.
- [x] Run the focused test and master verification; expect pass. Extend browser-purity coverage to reject server registry imports from client entry points.
- [x] Commit `feat: define modular tool and workflow contracts` including the reviewed spec/plan files.

**Execution clarification:** R1: Use schema-derived RunEventInput, a discriminated union without runId/seq, rather than non-distributive Omit. appendEvent and WorkflowIO.emit consume this union. R4: Capture effective fast/strong model selections and role mapping in the run model snapshot, without credentials. Defaults inherit existing selected settings; per-tool tier overrides are explicit. Helpers use that snapshot. Never infer a provider change from package prose. R11: Run contracts capture immutable prepared environment/lock refs and non-secret connection configuration revisions. Task 9 resolves these, Task 13 retains them for active/recoverable runs. Real credentials stay server-side and may rotate without copying secrets into run state.

**Additional Task-1 files (R12):** Modify `src/app/api/vault/file/route.ts`, `src/app/api/vault/list/route.ts`, and `src/lib/server/__tests__/vault-api.test.ts` for new private tools/tool-runs namespaces only.

### Task 2: Profile enablement and idempotent migration

**Create:** `src/lib/extensions/registry.ts`, `src/lib/extensions/profile-state.ts`, `src/lib/extensions/native-catalog.ts`, `src/lib/extensions/__tests__/profile-state.test.ts`.
**Modify:** `src/lib/server/local-profiles.ts`, `src/lib/server/__tests__/local-profiles.test.ts`.

**Interfaces:** `initializeProfileTools(ctx, origin: "new"|"legacy"): Promise<ProfileTools>`; `setToolEnabled(ctx, key: ToolKey, enabled: boolean): Promise<ProfileTools>`; `listEnabledTools(ctx): Promise<ToolManifest[]>`; `setToolBinding(ctx, key, patch): Promise<ProfileTools>`. Native IDs: package `scispark.builtin`, skills `trending`, `find-papers`, `deep-review`, `idea-spark`; capabilities `field-trends`, `paper-search`, `literature-review`, `research-ideas`. Advertise a tool as runnable only when its adapter is registered (Task 14).

- [x] Test fresh profiles, existing profile adoption, repeat migration, and re-enablement prevention:
  ```ts
  expect(Object.keys((await initializeProfileTools(ctx, "new")).enabled)).toEqual([])
  expect(Object.keys((await initializeProfileTools(other, "legacy")).enabled)).toHaveLength(4)
  await setToolEnabled(other, reviewKey, false)
  expect((await initializeProfileTools(other, "legacy")).enabled[reviewKey]).toBeUndefined()
  ```
  Seed existing chats/review records and assert byte-for-byte preservation. Also
  test a fresh empty configured default vault, not only `createLocalProfile`.
- [x] Run `npx vitest run src/lib/extensions/__tests__/profile-state.test.ts`; expect failure.
- [x] At new-profile creation, persist the empty state before publishing the profile record. Classify an already registered profile or a vault with pre-existing research as legacy once; an empty configured default vault is new. Persist origin before scaffolding/registration so a retry cannot relabel a new profile as legacy. Store the migration marker atomically, preserve existing native pins, and separate per-profile overrides.
- [x] Run both listed test files plus master verification. Verify disabled tools are absent from eligibility while artifacts remain readable.
- [x] Commit `feat: persist profile-specific tool enablement`.

### Task 3: Captured models and cumulative usage reservations

**Create:** `src/lib/workflows/model.ts`, `src/lib/workflows/usage.ts`, `src/lib/workflows/attempt-scope.ts`, `src/lib/workflows/__tests__/usage.test.ts`.
**Reference:** `src/lib/llm/settings.ts`, `src/lib/llm/scoped-pricing.ts`, `src/lib/review/budget.ts`, `src/lib/review/local-budget.ts`.

**Interfaces:** `resolveRunModel(ctx, binding): Promise<ToolRun["model"]>`; `reserveAttempt(ctx,runId,step:StepIntent,estimate:AttemptEstimate): Promise<AttemptTicket>`; `settleAttempt(ctx,ticket,result:AttemptResult): Promise<void>`; `extendAllowance(ctx,runId,operationId:string,delta:Partial<RunAllowance>): Promise<ToolRun>`; `getRunUsage(ctx,runId): Promise<RunUsage>`. Define `AttemptEstimate` (calls, activeSeconds, nullable cost, accounting owner), `AttemptTicket` (stable ID/reservation), `AttemptResult` (usage, nullable cost, known/unknown outcome, existing financial-ledger reference), and `RunUsage` in public contracts. Store only IDs/usage in the run journal, never credentials. Define `withRunAttemptScope(ctx,runId,work): Promise<T>` and hooks for the native bridge in Task 14.

- [x] Test concurrent reservations at the limit; known versus unknown pricing; CLI cost null; child-skill sharing; model override without settings mutation; captured model remaining unchanged after profile settings edits:
  ```ts
  await extendAllowance(ctx, run.id, extendId, { modelCalls: 5 })
  await extendAllowance(ctx, run.id, extendId, { modelCalls: 5 })
  expect((await readRun(ctx, run.id))!.allowance.modelCalls).toBe(35)
  expect((await getRunUsage(ctx, run.id)).modelCalls).toBe(usedBefore)
  ```
- [x] Run `npx vitest run src/lib/workflows/__tests__/usage.test.ts`; expect failure.
- [x] Reserve before dispatch; settle before another decision; retain uncertain reservations. Use existing scoped pricing, API daily controls and CLI single-attempt semantics. Do not automatically retry a structured-output repair or provider fallback without another reservation. Existing native ledgers retain billing ownership; workflow totals reference those attempts instead of billing twice.
- [x] Run focused/master verification. Test that reopening/resuming cannot clear spent or held usage and that secrets never enter events/model snapshots.
- [x] Commit `feat: meter workflow attempts across resumes`.

**Execution clarification:** R4: Capture effective fast/strong model selections and role mapping in the run model snapshot, without credentials. Defaults inherit existing selected settings; per-tool tier overrides are explicit. Helpers use that snapshot. Never infer a provider change from package prose. R5: Semantic intent classification has a chat-operation-keyed persisted metered attempt, using existing API daily/CLI controls. It precedes the root run and is not charged a second time to root counters. Preserve unknown outcome and the saved decision to prevent duplicate dispatch. R8: Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. Additional Modify: src/lib/workflows/contracts.ts. Test active-time enforcement while an attempt is in flight.

### Task 4: Durable coordinator and safe restart recovery

**Create:** `src/lib/workflows/journal.ts`, `src/lib/workflows/coordinator.ts`, `src/lib/workflows/adapters.ts`, `src/lib/workflows/__tests__/recovery.test.ts`.
**Modify:** `src/instrumentation.ts`; retain existing `recoverReviewJobs` and scheduler startup.

**Interfaces:** `registerWorkflowAdapter(kind:string, adapter:WorkflowAdapter): void`; adapter `execute(ctx,run,io): Promise<void>` where `io` exposes journaled `step(intent,work)`, `emit(event)`, `signal`, and artifact publication. `startRun(ctx,input): Promise<ToolRun>`; `observeRun(ctx,id): Promise<ToolRun>`; `cancelRun(ctx,id,operationId): Promise<void>`; `resumeRun(ctx,id,operationId): Promise<ToolRun>`; `recoverWorkflowRuns(contexts:WorkflowContext[]): Promise<void>`; `startWorkflowCoordinator(): Promise<()=>void>`. Coordinator resolves immutable versions from the registry, then captures actual model/allowance/intent server-side.

Export `WorkflowAdapter` and `WorkflowIO` from `adapters.ts` now. Define
`step<T>(intent:StepIntent, work:()=>Promise<T>):Promise<T>`, async `emit` over
the public event union, and `signal:AbortSignal`. Add typed artifact publication
to this interface in Task 6; do not create a duplicate IO type in Task 10.

- [x] Test fake-clock leases plus real disk reopen:
  ```ts
  expect((await startRun(ctx, request)).id).toBe((await startRun(ctx, request)).id)
  await recoverWorkflowRuns([reopenedCtx])
  expect(modelCalls).toBe(1) // started-but-unsettled model attempt was not replayed
  expect((await observeRun(reopenedCtx, run.id)).status).toBe("needs_attention")
  ```
  Also assert safe completed reads are reused, a safe pending step resumes, and the same operation ID with changed input is a conflict. Recovery preserves cancelled, paused-limit and waiting-for-choice/setup states; it does not bypass their required user action.
- [x] Run `npx vitest run src/lib/workflows/__tests__/recovery.test.ts`; expect failure.
- [x] Persist journal intent before execution and response/artifact hashes before advancing. Use random lease identity plus process identity and disk exclusivity; expiry alone must not duplicate a live owner. Never hold a state lock during model/network/process work. Start one coordinator per runtime via `globalThis`; enumerate registered profile roots for recovery, not only `SCISPARK_VAULT`. Skip during builds; return from instrumentation promptly. Opaque commands use reconciliation, not guessed replay safety.
- [x] Verify cancellation, two owners, unavailable pinned versions/models, killed owner, and disconnected observers. Run focused/master checks.
- [x] Commit `feat: resume durable workflows from safe checkpoints`.

**Execution clarification:** R1: Use schema-derived RunEventInput, a discriminated union without runId/seq, rather than non-distributive Omit. appendEvent and WorkflowIO.emit consume this union. R7: Coordinator owns typed idempotent action transitions and journal records; the host owns persisted helper continuations. Task 17 extends coordinator/journal/agent/usage services with resolveUncertain and chooseHelper, backend race/crash tests, then routes/UI. Routes never invoke adapters directly.

### Task 5: Authenticated run APIs and resumable observation

**Create:** `src/app/api/tools/route.ts`, `src/app/api/tools/runs/route.ts`, `src/app/api/tools/runs/[id]/route.ts`, `src/app/api/tools/runs/[id]/events/route.ts`, `src/app/api/tools/runs/[id]/actions/route.ts`, `src/lib/workflows/client.ts`, `src/lib/server/__tests__/workflow-api.test.ts`.
**Modify:** `src/lib/__tests__/browser-purity.test.ts`; reference `src/proxy.ts`, `src/lib/server/ndjson.ts` and the installed route-handler guide.

**Interfaces:** Collection GET lists redacted tools/runs; POST run validates `StartRunInput` and returns 202 plus durable run ID. GET snapshot/events is read-only; NDJSON events accept `after` cursor. Actions are strict `{operationId, action:"cancel"|"resume"|"extend", delta?}`. Client exports `startToolRemote`, `getToolRunRemote`, `listToolRunsRemote`, `watchToolRunRemote`, `actOnToolRunRemote`; match server schemas exactly. Detaching a watcher aborts only observation.

- [x] Test stale profile headers, expired sessions, invalid IDs/body size, disabled/missing tools, changed operation payload, and polling/reconnect:
  ```ts
  expect(await startTwiceWithSameOperation()).toHaveLength(1) // durable stored runs
  await getEventsThenDisconnect()
  expect(await adapterIsStillRunning()).toBe(true)
  expect((await staleProfileGet()).status).toBe(409)
  ```
  Define HTTP helpers in this test using actual route handlers and Task-4 deterministic adapter; no live server/model needed.
- [x] Run `npx vitest run src/lib/server/__tests__/workflow-api.test.ts`; expect failure.
- [x] Implement bounded bodies (64 KiB), profile-bound DTOs, `cache-control: no-store`, and cursor replay. Use the shared mutation/proxy security; never make the new API public or accept a client vault path. Persist event sequence before exposure; coalesce text snapshots to at most four writes per second and flush terminal text.
- [x] Run focused/master checks and `npm run build`; expect routes compiled without client filesystem imports.
- [x] Commit `feat: expose profile-bound workflow APIs`.

### Task 6: Artifacts and authorized wiki changes

**Create:** `src/lib/workflows/artifacts.ts`, `src/lib/workflows/wiki-save.ts`, `src/app/api/tools/runs/[id]/artifacts/[artifactId]/route.ts`, `src/app/api/tools/runs/[id]/save/route.ts`, `src/lib/workflows/__tests__/artifacts.test.ts`.
**Modify:** `src/lib/workflows/contracts.ts`, `src/lib/workflows/adapters.ts`, `src/app/api/vault/file/route.ts`, `src/app/api/vault/list/route.ts`, `src/lib/server/__tests__/vault-api.test.ts` to add the artifact input/IO contracts and protect new private state using the existing route pattern.

**Interfaces:** `publishArtifact(ctx,runId,input:ArtifactInput): Promise<Artifact>`; `readArtifact(ctx,runId,artifactId): Promise<{metadata:Artifact; bytes:Uint8Array}>`; `saveRunToWiki(ctx,runId,artifactIds:string[],operationId:string): Promise<{changesetId:string}>`. `ArtifactInput` carries bounded bytes, kind/title/mediaType/sourceRefs; storage paths are allocated internally. Use `parseChangeset`, `applyChangeset`, and persisted undo from `src/lib/vault/changesets.ts`.

- [x] Test traversal/symlink/HTML payloads, cross-profile artifact reads, valid source-linked paper/report/BibTeX artifacts, and duplicate save:
  ```ts
  expect((await saveRunToWiki(ctx, id, [artifact.id], op)).changesetId)
    .toBe((await saveRunToWiki(ctx, id, [artifact.id], op)).changesetId)
  expect(await originalPaperStillExists()).toBe(true)
  ```
  Add a crash between changeset application and journal settlement; recovery reconciles the stable changeset ID once. `outputs_only` never invokes an automatic wiki save.
- [x] Run `npx vitest run src/lib/workflows/__tests__/artifacts.test.ts src/lib/server/__tests__/vault-api.test.ts`; expect new cases to fail.
- [x] Persist artifact bytes then metadata atomically; verify hashes on read. Downloads use profile-bound URLs, `nosniff` and safe content disposition; HTML/SVG are attachment-only, never executed as same-origin plugin UI. Render Markdown through existing sanitization. Generate stable changeset identity before mutation and preserve divergence-aware undo. Add `publishArtifact(input:ArtifactInput):Promise<Artifact>` to `WorkflowIO`.
- [x] Run focused/master verification and a production build. Phase gate: deterministic adapter starts through HTTP, survives observer disconnect, respects allowance, and produces a retrievable artifact plus reversible authorized save.
- [x] Commit `feat: persist workflow artifacts and undoable wiki saves`.

**Execution clarification:** R6: Workflow DeepSpark always returns a validated proposal. Any authorized write is applied through the journaled Task-6 save mechanism with a stable preallocated changeset ID. Keep legacy apply defaults only for remaining authorized non-workflow callers. R10: Task 6 owns the durable server-side authorized save step and coordinator completion trigger. Task 10/14 submit validated proposals or completed artifacts to it. outputs_only never automatically writes. Task 17 only observes or requests an explicit save. Additional Modify: src/lib/workflows/coordinator.ts and its recovery tests. Test authorized automatic save with all observers detached and restart between publication and save.
