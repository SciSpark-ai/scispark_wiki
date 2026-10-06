# Modular Research Workspace Implementation Plan


**Current tracking (Task20):** Checked items record reviewed implementation and
executed offline/fixture checks, including explicit unsupported outcomes; they
are not live/OS/scientific passes. Mixed steps below remain unchecked where their
actual worker/install/CLI or final-review clause is open. The
[current requirement/evidence map](../../testing/2026-10-05-modular-workspace.md)
and [chronological R1–R59 rulings/costs](../../testing/artifacts/modular-workspace-2026-10-05/decisions.md)
govern current scope. Deferred minors remain in the
[final-review handoff](../../testing/artifacts/modular-workspace-2026-10-05/review-handoff.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver the agreed modular workspace, including optional native tools, imported research skills, consented discovery from other agents, and durable background execution.

**Architecture:** Keep the core application and existing model providers. Add a versioned extension registry and a profile-bound workflow coordinator; imported instructions use a host-controlled tool loop, while executable commands run behind an OS-enforced boundary. Tools and Sparky observe the same durable runs and artifacts.

**Tech Stack:** Existing Next.js 16.3, React 19.2, TypeScript, Zod, filesystem vault, Vitest and Playwright. Proposed additions: an exact-pinned sandbox runtime and managed Python/Node tool environments; no external database or cloud worker.

**Spec:** [Agreed product design](../specs/2026-10-05-modular-workspace-design.md).

## Global Constraints

- "Start with the core workspace only. Users add optional tools from Tools when wanted."
- "Built-in tools and imported tools are equal candidates."
- "Select one top-level tool per run." Supporting skills share its authorization and limits.
- "Each profile has its own enabled tools, settings, and model overrides."
- "Other profiles remain separate." Full-vault access means research content, not secrets.
- "Loading a skill" is not execution: discovery/import requires the user's selection.
- "Cloud execution is deferred." Work requires the local runtime; browser navigation is not cancellation.
- "Pausing, resuming, or restarting must preserve cumulative usage."
- "Keep rollback available and keep active runs on their original version."
- Preserve semantic tokens, rounded content boxes, concise copy, Markdown, streaming, citations, changeset validation and undo. Read `design.md` before UI edits.
- Preserve scheduler heartbeat, review reservation ledgers, `scoped-pricing.ts`, source guards, and existing research records. Do not edit unrelated local brand assets/scripts.
- A virtual environment is not a sandbox. Never run an imported command unrestricted when the isolation probe fails.
- Existing provider restrictions remain in place. Both Codex and Claude Code are first-class engine paths; do not silently switch to a paid API.

## Review Focus

1. Stale tabs/profile switches and simultaneous requests must not cross vaults or start duplicate work: Tasks 2, 4, 5, 19.
2. A crash after an external action but before its response is saved must not cause an automatic duplicate call/write: Tasks 3, 4, 6, 19.
3. Same-named skills, cyclic/missing dependencies, and edited local installations must preserve identity and active-run versions: Tasks 7, 12, 13, 16.
4. Hostile archives, symlinks, setup scripts, and permission-expanding updates must stay inside the approved package/run boundaries: Tasks 7–9, 13, 19.
5. Disabling a module or migrating an existing profile must preserve saved results and core feed/digest/chat/wiki/graph behavior: Tasks 2, 14, 17, 19.

---

## Execution order and deliverables

This is one feature delivered through three linked implementation plans. Execute
in order; a phase passing is not a claim that the entire feature is complete.

| Plan | Tasks | Independently testable outcome |
| --- | --- | --- |
| [1. Foundation](2026-10-05-modular-workspace-1-foundation.md) | 1–6 | Profile-bound registry, durable jobs, model/usage accounting, authenticated observation, artifacts and undoable saves; validated with deterministic adapters. |
| [2. Imports and execution](2026-10-05-modular-workspace-2-imports.md) | 7–13 | GitHub/local/agent imports, isolated setup/execution, pinned dependencies, updates, and a fail-closed OpenCite command path; actual supported-host phase acceptance remains OPEN (R31). |
| [3. Product integration](2026-10-05-modular-workspace-3-product.md) | 14–20 | Native tools, Tools UI, Sparky choice/routing, History, imported literature review, production browser/restart checks and release evidence. |

### Before Task 1

- [x] Read the spec, `AGENTS.md`, `CLAUDE.md`, `design.md`, and the installed Next.js route-handler/instrumentation guides. Verify `agents.md` and `project_memory.md` exist.
- [x] Inspect current Git state and preserve all unrelated work. Planning baseline was `main` at `435afcd886d810b66258aaae83734c5868f721cf`; only the design document was untracked before this plan was written. Recheck before execution.
- [x] Create `codex/modular-research-workspace` from the reviewed main baseline. Do not discard changes or move to a different starting revision silently. Carry these plan/spec files into the implementation branch.
- [x] Record fresh `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, and `npm run build` results in `docs/testing/2026-10-05-modular-workspace.md`. Do not reuse historical test counts as current evidence.
- [x] Preserve the human server and vault. All fixtures, migration tests, installs, command execution, and E2E use disposable roots and isolated ports. No actual installed-skill scan or paid experiment is authorized merely by this plan.

### Task verification and commits

Every task has a focused failing regression, implementation, focused passing
verification, then `npx tsc --noEmit`, `npm run lint`, and `npx vitest run`.
Expected: zero type/lint errors, no warnings beyond the measured baseline, and
no unexplained lost/skipped tests. Verify production build at each phase gate.
If generated Next types refer to deleted routes, regenerate with the installed
Next tooling; do not edit generated files or weaken TypeScript checks.

Commit once per completed task using its specified message, with
`Co-authored-by: Codex <codex@openai.com>`. Stage only the task's explicit files
and their required tests. Commit the spec/plan set with Task 1. No push, PR,
merge, package installation on the user's real profile, or paid live test is
part of writing this plan. Publication is a separate user action.

## Interfaces shared across the plans

Task 1 owns the following public contracts in `src/lib/extensions/contracts.ts`
and `src/lib/workflows/contracts.ts`. Use strict Zod schemas and inferred types;
the notation below defines fields, not a second handwritten validation layer.

```ts
type ToolRef = { packageId: string; skillId: string; version: string; digest: string }
type ToolKey = string // canonical JSON encoding of [packageId, skillId]; never a filesystem path
type ToolManifest = {
  ref: ToolRef; name: string; description: string; capabilities: string[];
  kind: "native" | "instructions" | "command";
  entrypoint: string; dependencies: ToolRef[];
  resources: string[]; connections: string[]; engines: string[];
  inputSchema: Record<string, unknown>; outputKinds: string[];
  provenance: { source: "builtin" | "github" | "local" | "agent"; locator: string; revision: string };
}
type RunAllowance = { modelCalls: number; commandCalls: number; activeSeconds: number; costUsd: number | null }
type RunStatus = "queued" | "running" | "waiting_for_choice" | "waiting_for_setup" |
  "paused_limit" | "interrupted" | "needs_attention" | "completed" | "failed" | "cancelled"
type StartRunInput = {
  operationId: string; tool: ToolRef; input: Record<string, unknown>;
  sessionId?: string; contextRefs: string[]; allowance?: Partial<RunAllowance>;
  writeIntent: "outputs_only" | "update_wiki";
}
type StepIntent = { id: string; kind: "model" | "command" | "read" | "wiki_write";
  replay: "read_only" | "idempotent" | "reconcile"; inputHash: string }
type Artifact = { id: string; kind: "markdown" | "papers" | "bibtex" | "file";
  title: string; path: string; sha256: string; mediaType: string; sourceRefs: string[] }
```

Task 1 also defines `ToolRun` with schemaVersion=1, UUID id, profileId/vaultId,
operationId, immutable root/dependency refs, input/contextRefs, captured model
configuration without secrets, writeIntent, allowance, cumulative counters,
status, timestamps, monotonic event cursor, artifact references, and optional
native run reference. `RunEvent` is a discriminated union of status, public text
snapshot, artifact, choice, and error events with `runId` and monotonic `seq`.
Never stream private model reasoning. `ProfileTools` stores schemaVersion=1,
explicit enabled bindings, pins, overrides, and a migration marker. Optional
manifest data (license/required runtimes/install recipe) belongs to validated
subschemas introduced in Task 7, not unvalidated arbitrary executable strings.

Server-only `WorkflowContext` in `src/lib/workflows/context.ts` contains
`profileId`, canonical `vaultId`, `vaultPath`, `runtimeRoot`, and `storage: VaultStorage`.
Resolve this once from the request's authenticated profile. Recovery resolves it
from the persisted owning profile; never from the browser's current selection.

### Storage ownership

- Vault: `.scispark/tools/state.json` and `.scispark/tool-runs/<uuid>/` containing
  `run.json`, `events/`, `steps/`, `artifacts/`, and `usage.json`.
- Outside vaults: `<profile-registry>/extensions/objects/<sha256>/` for immutable
  package snapshots, and `extensions/profiles/<profileId>/` for environments,
  scratch spaces, consent records and opaque connection bindings. Real secrets
  remain in the existing server-only credential boundary, never package/run files.
- Use existing `NodeFsVaultStorage` atomic writes/exclusivity. Add a narrow
  `getProfileRegistryRoot(env?)` export rather than duplicating registry-root
  resolution. Reject overlapping vault/runtime roots and resolve aliases.
- Generic vault routes must deny the new private tool state; authenticated
  workflow APIs expose redacted DTOs and validated artifact downloads only.

### Concrete initial limits (implementation defaults, adjustable)

- Per run: 30 model calls, 60 command invocations, 1,800 active seconds;
  API cost cap $2 when known pricing is available, still bounded by the existing
  daily cap. Subscription runs use `costUsd: null`. Unknown API pricing needs
  a configured rate or model change before claiming monetary enforcement.
- Per command: 300 seconds, 2 MiB combined captured output; terminate the whole
  process tree on cancellation/limit. Persist an uncertain outcome when necessary.
- Archive: 50 MiB compressed, 250 MiB expanded, 10,000 entries, 25 MiB per file;
  inspect streamed bytes and actual expansion, not just Content-Length.
- Instruction/resource context: at most 64,000 characters per model request,
  with paged resource reads rather than silently omitting required files.
- Immutable run model/tool versions; allowance extensions are positive deltas
  using an idempotency key. A new conversation does not reset an existing run.
- One active root tool workflow per profile initially; FIFO queue additional
  runs. Supporting nodes may fan out by two, with command execution serialized
  per profile. Core feed/digest/chat are not blocked by that workflow queue.

These limits are engineering starting values, not permission for live spending.
Task 18 verifies the bounded review fits or reports a justified calibration.

## Runtime choice and evidence

Propose `@anthropic-ai/sandbox-runtime` behind our own small adapter. Upstream
documents filesystem/network enforcement and platform-specific backends; its
package metadata currently says 0.0.78 and Node >=22.12.0. Task 8 must verify the
published artifact, pin its integrity, and pass real process-isolation probes
before use. The planning machine is on Node v24.3.0; no dependency was installed
during planning. A failed probe is an unavailable execution mode, never an
unrestricted fallback. [Runtime documentation](https://github.com/anthropic-experimental/sandbox-runtime),
[package metadata](https://raw.githubusercontent.com/anthropic-experimental/sandbox-runtime/main/package.json).

OpenCite declares Python >=3.11; use managed Python 3.12 with an exact locked
OpenCite release and its PDF extras in the curated recipe. Source skill packages
and the executable dependency have separate identities/licenses/version locks.
[OpenCite package requirements](https://github.com/neuromechanist/opencite/blob/main/pyproject.toml).

## Coverage map

| Spec area | Implementing tasks |
| --- | --- |
| Core-only new profiles; preserve migrated users | 2, 14, 15, 19 |
| Tools and Sparky, pins, model inheritance | 3, 14–17 |
| Automatic intent match; ambiguity chooser; supporting skills | 10, 16, 18 |
| GitHub/local/agent imports and managed dependencies | 7–12, 15 |
| Full active research context; profile isolation; explicit writes | 2, 6, 8, 10, 19 |
| Durable work, restart recovery, usage limits | 3–5, 8, 10, 19 |
| Manual updates, version pins, rollback | 7, 13, 15, 19 |
| OpenCite then literature-review acceptance | 11, 18–20 |

## Completion evidence

Task 20 reports the branch and per-task commits, final type/lint/unit/build
results, production browser evidence, actual OS-isolation results, and separately
labelled fixture/public-source/paid-provider results. Retain screenshots of the
empty-profile Tools flow, ambiguous Sparky choice, an active run after navigation,
and completed source-linked results. Missing live or OS evidence is a specific
open gate, not proof of compatibility. Do not label a prototype or simulated
review as a fully verified external workflow.

Current tracking: implementation Tasks1–19 have reviewed commits and completed
offline/production browser gates. Task20 docs/evidence are ready for review.
The requirement map checks actual source callers and preserves every confirmed
decision. Real command isolation/install/CLI/broker, real sources/providers and
scientific acceptance remain OPEN; final whole-branch review is pending.

## Execution preflight clarifications — 2026-10-05

These engineering rulings repair cross-task contracts without changing the agreed product scope. They govern the corresponding task text.

- **R1:** Use schema-derived RunEventInput, a discriminated union without runId/seq, rather than non-distributive Omit. appendEvent and WorkflowIO.emit consume this union. Reason: Standard Omit loses branch payload types. Cost if wrong: Event callers require coordinated type changes if this shape is wrong.
- **R2:** Command isolation accepts a host-created run or setup scope. Setup has a durable setup ID, writes only its staged environment and scratch roots, has no research projection, and has separately allowlisted registry network access. Permit only a specifically authenticated broker/control channel; never general localhost. Reason: Dependency preparation needs a distinct enforced scope. Cost if wrong: The worker and installer require rework if a platform cannot enforce these boundaries; execution must remain unavailable.
- **R3:** Only declared dependency capability slots with immutable eligible candidate refs can require helper choice. Genuinely undeclared helper calls reject or need setup. Persist the chosen candidate against its parent step; new installations never enter an active run graph. Reason: User choices cannot expand an already authorized graph silently. Cost if wrong: Some imported skill workflows may need explicit dependency adaptation.
- **R4:** Capture effective fast/strong model selections and role mapping in the run model snapshot, without credentials. Defaults inherit existing selected settings; per-tool tier overrides are explicit. Helpers use that snapshot. Never infer a provider change from package prose. Reason: The review protocol and existing orchestrators use model tiers. Cost if wrong: Model snapshot/UI migration may be needed if tier mapping proves insufficient.
- **R5:** Semantic intent classification has a chat-operation-keyed persisted metered attempt, using existing API daily/CLI controls. It precedes the root run and is not charged a second time to root counters. Preserve unknown outcome and the saved decision to prevent duplicate dispatch. Reason: A top-level chooser exists before any root run. Cost if wrong: A separate classification usage line must remain clear to users.
- **R6:** Workflow DeepSpark always returns a validated proposal. Any authorized write is applied through the journaled Task-6 save mechanism with a stable preallocated changeset ID. Keep legacy apply defaults only for remaining authorized non-workflow callers. Reason: A lost native response must not duplicate a wiki write. Cost if wrong: Native result adaptation must preserve every proposed page and provenance.
- **R7:** Coordinator owns typed idempotent action transitions and journal records; the host owns persisted helper continuations. Task 17 extends coordinator/journal/agent/usage services with resolveUncertain and chooseHelper, backend race/crash tests, then routes/UI. Routes never invoke adapters directly. Reason: Retry and helper choice must share run ownership and counters. Cost if wrong: Action APIs may need adjustment together with their clients.
- **R8:** Explicit task files include every contract/service changed below. Baseline evidence is created before Task 1 and updated in Task 20. Required production integration targets are in scope even when omitted from an original file list. Reason: Several interfaces lacked their owning file in the plan. Cost if wrong: Small scope expansion must be reviewed per task.
- **R9:** Task 12 defines strict grant/revoke/discover/stage action DTOs. Task 13 defines binding/update/rollback/removal DTOs with operation IDs and active-run disposition finish or cancel; an unspecified disposition returns decision-required. Task 15 consumes these same schemas. Reason: UI actions need unambiguous authenticated server contracts. Cost if wrong: Mutation DTOs and UX may need coordinated changes if an action is missing.
- **R10:** Task 6 owns the durable server-side authorized save step and coordinator completion trigger. Task 10/14 submit validated proposals or completed artifacts to it. outputs_only never automatically writes. Task 17 only observes or requests an explicit save. Reason: Automatic wiki updates must finish without a browser observer. Cost if wrong: Completion and save reconciliation require coordinated changes if the trigger is wrong.
- **R11:** Run contracts capture immutable prepared environment/lock refs and non-secret connection configuration revisions. Task 9 resolves these, Task 13 retains them for active/recoverable runs. Real credentials stay server-side and may rotate without copying secrets into run state. Reason: Version-pinned code must also resume in its original dependency environment. Cost if wrong: Retained environments use additional disk space until safe collection.

- **R12: Move only new private tools/tool-runs generic-vault file/list protections and their vault-api regression cases from Task 6 into Task 1. Task 6 retains artifact/save extensions. This makes private storage private immediately without changing legacy accessible records. Cost if wrong: a previously unknown generic consumer of the new namespaces would need a dedicated API.**

## Current unresolved acceptance

- [ ] Actual supported-host imported-command/OpenCite phase gate; Mac unsupported (descendant ownership), Linux/Windows unrun.
- [ ] Real source acquisition, selected API/Codex/Claude Code compatibility and human claim/coverage validation under the exact [live-check protocol](../../testing/modular-workspace-live-check.md).
- [ ] Task20 review and one separate final whole-branch review; deferred minors remain recorded.

Final code gate:3291passed/24gatedskips (baseline2710/19), type/lint0 with one
baseline warning; fresh regular27.55s/acceptance27.18s builds restore exact config
bytes. Production modular11/core6 remain valid for unchanged scopes; fresh R58
native2 covers the prepared native admission correction. No full live phase claim.
