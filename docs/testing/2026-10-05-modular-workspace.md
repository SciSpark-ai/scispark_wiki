# Modular workspace implementation evidence

Status: implementation in progress; no release claim.
Branch: `codex/modular-research-workspace`.
Base: `435afcd886d810b66258aaae83734c5868f721cf`.

## Baseline — 2026-10-05

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Exit 0 |
| `npm run lint` | Exit 0; one pre-existing ConnectAiCard exhaustive-deps warning, no errors |
| `npx vitest run` | 2710 passed, 19 skipped; 275 passed files, 7 skipped |
| `npm run build` | Exit 0; Next.js 16.3.2 Turbopack, 64 static pages generated |

Build used `.next-modular-baseline`, a disposable vault/profile registry under
`/tmp/scispark-modular-baseline`, and scheduler off. The initial sandboxed build
stalled at compilation and was terminated; the same isolated build passed with
broader local process permissions. Generated TypeScript path edits were checked
and restored. Raw baseline logs are in that temporary directory.

No human-vault migration, installed-agent scan, imported workflow execution or
live model call was performed for this baseline.

## Task evidence

To be recorded as tasks pass independent review.

### Task 1 implementation candidate — independent review pending

Implemented strict public extension/workflow schemas, authenticated canonical
workflow context, private profile tool state, immutable run snapshots and
crash-aware ordered event storage using existing vault atomic writes/exclusivity.
Profile ownership accepts existing 32-hex IDs and UUIDs. Runtime boundaries compare
registry/extensions with each canonical vault, preserving registry/vaults layout.
R12 moves only new tools/tool-runs generic file/list protections into this task.

| Check | Result |
| --- | --- |
| Focused initial RED: `npx vitest run src/lib/workflows/__tests__/store.test.ts` | Missing `../../extensions/contracts`; 1 failed suite, no collected tests |
| Privacy RED: `npx vitest run src/lib/server/__tests__/vault-api.test.ts` | 9 expected failures, 67 existing cases passed |
| Self-review path RED: `npx vitest run src/lib/workflows/__tests__/store.test.ts` | 1 expected schema rejection failure, 9 passed; Windows/whitespace path gap |
| Final focused GREEN: store/context/vault-api/browser-purity/local-profiles files | 107 passed across 5 files |
| Final `npx tsc --noEmit` | Exit 0 |
| Final `npm run lint` | Exit 0; existing ConnectAiCard warning only |
| Final `npx vitest run` | 2734 passed, 19 gated skips; 277 passed files, 7 skipped; 31.14 seconds |
| `git diff --check` | Exit 0 |

Added 24 regressions: 10 workflow-store cases, 1 authenticated-context case,
9 private vault-route cases, and 4 browser-purity cases. Files are
`src/lib/workflows/__tests__/store.test.ts`,
`src/lib/workflows/__tests__/context.test.ts`,
`src/lib/server/__tests__/vault-api.test.ts`, and
`src/lib/__tests__/browser-purity.test.ts`.

The first full suite also passed (2734/19); its tsc run caught only test env
NODE_ENV widening, corrected with a ProcessEnv annotation. Self-review then
introduced artifact path regression assertions and reused the existing pure
safe-path validator, after which focused and all full checks were repeated.
Raw RED/GREEN/full logs: `/tmp/scispark-task-1-{red,private-red,path-red,green,tsc,lint,vitest}.log`.
No additional build was needed; the recorded isolated baseline build remains
applicable. No real vault, installed skill scan, live provider, push or merge.

### Task 1 review fix I1 — independent re-review pending

The first review found a directory-symlink bypass of lexical workflow path
protection. Added NodeFsVaultStorage.hasSymlinkTraversal and a generic file
boundary helper: resolve legitimate vault-root aliases, then lstat each requested
component and reject any symlink before GET/PUT/DELETE storage access. Existing
parents are checked even for nonexistent leaf files or nested directories.
Server-owned persistence operations retain their existing behavior.

Three disposable filesystem regression cases cover both tools/tool-runs aliases,
parent and leaf links, new leaves/new nested parents, preservation of original
private content, ordinary legacy files, and a legitimate alias of the vault root.

| Check | Result |
| --- | --- |
| RED: `npx vitest run src/lib/server/__tests__/vault-api.test.ts` | 2 failed, 77 passed; alias GET returned 200 instead of 403 for both private namespaces |
| GREEN: vault-api/local-profiles/workflow store+context/NodeFs/browser-purity | 123 passed across 6 files |
| `npx tsc --noEmit` | Exit 0 |
| `npm run lint` | Exit 0; only existing ConnectAiCard warning |
| `npx vitest run` | 2737 passed, 19 gated skips; 277 passed/7 skipped files; 34.79 seconds |
| `git diff --check` | Exit 0 |

Full checks ran once on final fixed source. Logs:
`/tmp/scispark-task-1-fix-1-{red,green,tsc,lint,vitest}.log`.
M1 event-log append performance is deferred to Task 5 by the controller;
model/runtime/connection/artifact/recovery integrations retain their later-task
ownership. Task 1 remains one amended local commit, pending independent review.

### Task 2 implementation candidate — independent review pending

Added profile-specific tool bindings, pins and model overrides, with an atomic
read/modify/write helper under the existing profile-tools exclusion boundary.
Native catalog identities are `scispark.builtin` / `trending`, `find-papers`,
`deep-review`, `idea-spark`; their respective capabilities are `field-trends`,
`paper-search`, `literature-review`, `research-ideas`.
Enabled catalog entries remain distinct from exact-version adapter readiness;
no production adapter is registered in this task. Imported metadata can use the
same registry and profile-binding operations without discovery or execution.

New configured and created profiles persist empty tool state before registry
publication. Registered profiles without an origin marker adopt legacy defaults
once. Origin is persisted outside research in
`extensions/profiles/<profileId>/origin.json`, checked against the profile and
canonical vault identity, before state writing/scaffolding/publication. Failed
state or registry publication retains that origin for retry. Default-vault startup
now captures ownership/origin before its existing scaffold and review-recovery
path; bootstrap does not load user-authored profile metadata. Disabled bindings,
existing native pins, separate overrides, and existing chat/review bytes remain
preserved.

| Check | Result |
| --- | --- |
| Initial RED: profile-state file | Missing native-catalog module; 1 failed suite |
| Profile integration RED: local-profiles file | 5 failed, 4 passed; missing migration/state and startup origin |
| Registry parity RED: profile-state file | 1 failed, 9 passed; missing registerToolManifest |
| Final focused GREEN: profile-state/local-profiles/workflow-context | 20 passed across 3 files |
| Final `npx tsc --noEmit` | Exit 0; 5.89 seconds |
| Final `npm run lint` | Exit 0; existing ConnectAiCard warning only; 15.35 seconds |
| Final `npx vitest run` | 2750 passed, 19 gated skips; 278 passed/7 skipped files; command 30.43 seconds |
| `git diff --check` | Exit 0 |

Added 13 regressions: 10 profile-state cases and 3 local-profile integration cases;
existing adoption/creation cases also assert migration and empty-state behavior.
Fixtures are disposable in-memory storage plus temporary filesystem registries.
Full gates ran once on final source via `verify-task.py task-2`; logs/results are
in `.superpowers/sdd/2026-10-05-modular-workspace/verification/task-2/`.
RED and focused logs: `/tmp/scispark-task-2-{red,profiles-red,registry-red,focused}.log`.
No build was required by this task. No human vault/profile reads or migrations,
installed-skill scans, live provider calls, installs, push or merge were performed.
Registry installation, adapter implementation and user-facing routing retain
later-task ownership; this is an implementation candidate, not a release claim.

### Task 3 implementation candidate — independent review pending

Added immutable effective fast/strong model snapshots and role mapping, including
explicit per-tool overrides and captured endpoint/engine choices. Credentials
remain server-only. Durable attempt journals reserve model/command calls,
active-time ceilings and known API cost before dispatch; unknown outcomes keep
holds across resume. Native attempts retain their financial-ledger ownership.
Daily API and review controls now include workflow-owned holds. Dispatch claims
prevent replay of the same ticket; active-time limits abort in-flight work.
Allowance extensions are positive, idempotent operations with journal-first crash
recovery. Ordinary run writes cannot bypass journal-owned allowances or usage.

| Check | Result |
| --- | --- |
| Initial focused RED | Missing model module; 1 failed suite |
| Journal ownership RED | 1 failed/11 passed; direct allowance edits bypassed the journal |
| Endpoint RED | 1 failed/12 passed; unsupported provider endpoint was accepted |
| Repeated uncertainty RED | 1 failed/12 passed; later unknown observation reduced a reported overrun hold |
| Final focused GREEN | 13 passed; no warnings |
| Final `npx tsc --noEmit` | Exit 0; 2.87 seconds |
| Final `npm run lint` | Exit 0; existing ConnectAiCard warning only; 15.99 seconds |
| Final `npx vitest run` | 2763 passed/19 gated skips; 279 passed/7 skipped files; command 30.59 seconds |
| `git diff --check` | Exit 0 |

Final full gate: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-3`.
Logs/results: `.superpowers/sdd/2026-10-05-modular-workspace/verification/task-3/`.
Focused logs: `/tmp/task3-{red,regression-red,endpoint-red,uncertain-red,green}.log`.
Full gates were repeated only for concrete self-review source fixes. New tests
use memory fixtures and disposable directories, including independent filesystem
handles, crash-after-journal recovery, root/helper sharing, scoped-price mismatch,
unknown pricing, CLI null cost, foreign tickets, native billing and abort handling.

Task 4 owns coordinator recovery/status decisions over held dispatched attempts;
Task 14 owns production native bridge integration. R5 pre-root classification
persistence belongs to Task 16 and is not charged to root counters by this task.
The implementer report records concrete hook signatures and their billing/signal
contracts. No personal vault, installed-skill scan, live LLM call, install, push,
or merge was performed. This is an implementation candidate, not a release claim.

#### Task 3 independent-review fix 1 — reject terminal dispatch claims

The review found that a saved unclaimed reservation could dispatch after its root
became completed, failed or cancelled, including a terminal transition between
reserve and claim. `claimAttemptDispatch` now checks the current run status inside
the workflow lock before consuming dispatch permission. Existing-ticket readback
and cumulative usage remain unchanged.

| Check | Result |
| --- | --- |
| RED: `npx vitest run src/lib/workflows/__tests__/usage.test.ts` | 4 failed/13 passed: terminal direct claims resolved; reserve-to-claim race executed callback |
| GREEN: same focused command | 17 passed; no warnings |
| `npx tsc --noEmit` | Exit 0; 3.57 seconds |
| `npm run lint` | Exit 0; existing ConnectAiCard warning and generated-cards Babel note only; 16.17 seconds |
| `npx vitest run` | 2767 passed/19 gated skips; 279 passed/7 skipped files; command 30.40 seconds |
| `git diff --check` | Exit 0 |

Full command: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-3-fix-1`.
Exact full logs/results are in `verification/task-3-fix-1/` under the local SDD
folder; focused logs are `/tmp/task3-fix1-{red,green}.log`. Reopened filesystem
fixtures cover all three terminal states, direct claims, wrapper rejection,
no external callback, no dispatchedAt write, and retained usage. A deterministic
queued cancellation covers the reservation-to-claim boundary. No changes beyond
the reported finding. The original Task 3 commit is amended for scoped re-review.

### Task 4 — durable coordinator and safe restart recovery

Added typed WorkflowAdapter/WorkflowIO, durable start/action/step journals,
PID-fenced random leases, profile FIFO queues, cancellation and explicit resume,
and registry-wide startup recovery. Completed response checkpoints are hash-checked
and reused; pending model/command outcomes and dispatched holds require attention.
Recovery preserves all user-action gates and never replaces a captured version or
model. Browser observation does not own execution. Instrumentation returns promptly
while preserving review recovery and scheduler startup; builds and Edge skip it.

Narrow Task 3 integrations add root AbortSignal inheritance, paused/action dispatch
claim checks, and a run/step-specific pre-dispatch WorkflowLimitError. That error
allows safe paused-limit recovery only before the matching step dispatches; it
cannot convert an unknown outcome into a replayable step. Generic run writes cannot
bypass journal-owned lifecycle status. Task 6 still owns typed artifact publication;
Task 17 owns uncertainty/helper actions and host continuation integration.

| Check | Result |
| --- | --- |
| Initial focused RED | Missing adapters module; one failed recovery suite |
| Root signal RED | 1 failed/15 passed: nested attempt dispatched after paused_limit |
| Instrumentation RED | 1 failed/2 passed: register waited for pending review recovery |
| Lifecycle ownership RED | 1 failed/28 passed: generic run write resurrected cancelled status |
| Final focused workflow GREEN | 60 passed across 5 files; pristine output |
| `npx tsc --noEmit` | Exit 0; 3.42 seconds |
| `npm run lint` | Exit 0; existing ConnectAiCard warning and generated-cards Babel note only; 15.85 seconds |
| `npx vitest run` | 2799 passed/19 gated skips; 281 passed/7 skipped files; command 30.39 seconds |
| `git diff --check` | Exit 0 |

Full gate: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-4`.
Exact logs/results: `.superpowers/sdd/2026-10-05-modular-workspace/verification/task-4/`.
Focused logs: `/tmp/task4-{red,signal-red,startup-red,startup-green,lifecycle-red,focused-green}.log`.

29 recovery cases and 3 instrumentation cases cover real disposable disks,
independent owners, same-operation conflicts, equal-clock FIFO, safe checkpoint
reuse, corrupt checkpoint hashes, partial-write recovery, preserved pause/choice/
setup/cancellation states, cumulative usage after idempotent extension and resume,
captured-model preflight, all registered profile roots and startup singleton.
A separate Node/Vite-loaded coordinator process runs the actual implementation
with a synthetic model callback: a fake-clock-expired live lease is not stolen;
after SIGKILL, disk reopen yields needs_attention with exactly one consumed call
and no adapter replay. This verifies real process recovery with synthetic work,
not live model/provider acceptance. No human vault, installed-skill scan, live LLM
request, install, push or merge was used.

#### Task 4 independent-review fix 1 — authorize from the lifecycle journal

Review reproduced a cancellation journal commit followed by run.json mirror
failure: attempt claims and new reservations still read the stale running mirror.
Usage state now validates the authoritative lifecycle record and its owning
run/profile/vault inside the existing workflow-ID lock. It uses that status for
reservation/claim gates and subsequent usage mirror writes, without recursively
locking a repair reader. Existing-ticket readback remains idempotent. The original
strict lifecycle/lease schemas moved to shared contracts to avoid duplicate
validators or an import cycle; these internal records are not public API DTOs.

| Check | Result |
| --- | --- |
| RED: recovery test | 9 failed/29 passed: stale-mirror claims, independent wrapper callback, new reservations and malformed/foreign lifecycle records were accepted |
| GREEN: recovery + usage tests | 55 passed across 2 files; pristine output |
| `npx tsc --noEmit` | Exit 0; 2.77 seconds |
| `npm run lint` | Exit 0; existing ConnectAiCard warning and generated-cards Babel note only; 15.54 seconds |
| `npx vitest run` | 2808 passed/19 gated skips; 281 passed/7 skipped files; command 31.26 seconds |
| `git diff --check` | Exit 0 |

Full command: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-4-fix-1`.
Full logs/results: `verification/task-4-fix-1/` under the local SDD directory.
Focused logs: `/tmp/task4-fix1-{red,green}.log`.

The new disk-reopen regressions check cancelled, paused_limit, waiting_for_choice,
waiting_for_setup and needs_attention immediately after a committed journal with
failed mirror, before observe/recover repair. Prior tickets remain readable, direct
claims and an independently reserved wrapper are denied, callbacks never run, new
reservations consume no usage, and usage.json stays byte-identical. Separate
runId/profileId/vaultId/status corruptions fail closed. Only this review finding
was changed; Task 4's existing unpushed commit is amended for scoped rereview.

### Task 5 — authenticated workflow APIs and resumable observation

Added profile-bound tools/runs collection, start, snapshot, finite NDJSON cursor
replay and strict cancel/resume/extend routes. Shared request handling uses the
proxy's mutation guard, an authenticated session plus exact expected profile,
64 KiB streamed-byte body limits, generic redacted errors and no-store responses.
The catalog shares curated native choices and includes only this profile's
imported bindings/pins, including disabled choices. Public run DTOs omit input,
vault identity, captured model/configuration, environments, connections and native
internal references; lifecycle leases/journals are never returned.

HTTP snapshots project committed lifecycle/usage journals and durable event tails
without repairing mirrors, starting recovery or taking write locks. The small
read-only context option avoids recreating a removed private extension runtime;
existing profile bootstrap/auth behavior is preserved. Browser helpers validate
these same schemas, replay NDJSON with a cursor, poll and drain a terminal cursor,
and detach by aborting observation alone. A server emission queue coalesces text
snapshots at 250 ms spacing (including immediate resumes/restarts), flushes before
lifecycle transitions/cancellation, and keeps rejected action conflicts from
aborting the worker. Cross-kind action ID reuse conflicts under the existing run
lock. Task 1's deferred M1 is included: appends and lifecycle writers read bounded
tail payloads; cursor replay reads only requested event payloads, retaining
identity validation and event-before-cursor crash recovery.

| Check | Result |
| --- | --- |
| Initial focused RED | Missing tools route module; one failed API suite, expected before implementation |
| Final focused GREEN | 67 passed across API/store/recovery/context; pristine output |
| `npx tsc --noEmit` | Exit 0; 3.48 seconds |
| `npm run lint` | Exit 0; existing ConnectAiCard warning and generated-cards Babel note only; 15.48 seconds |
| `npx vitest run` | 2826 passed/19 gated skips; 282 passed/7 skipped files; command 30.56 seconds |
| Isolated `npm run build` | Exit 0; compiled in 9.4 seconds; all five workflow routes present |
| `git diff --check` | Exit 0 |

Full gate: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-5`.
Exact logs/results: `.superpowers/sdd/2026-10-05-modular-workspace/verification/task-5/`.
Focused/RED logs and full report are in the local SDD scratch directory. Build
logs, exit statuses, exact pre-build config backups and cleanup evidence are in
its `task-5-build/` folder. The build used `.next-modular-task-5`, disposable
`/tmp/scispark-modular-task-5/{vault,profiles}` roots and scheduler off. Turbopack
stalled under the sandbox; only that identified build process was stopped (143),
then the same isolated build passed with scoped escalation. Only this build's
two generated tsconfig includes and routes/root-params import paths were restored,
after validating the differences against this task's exact pre-build bytes.

17 actual-handler tests exercise real disposable session expiry plus deterministic
adapters, stale profile/foreign origin, body bytes/strict schemas/IDs, disabled and
missing/foreign tools, durable start/action idempotency, cumulative resume usage,
failed lifecycle/usage mirror read-only projection, observer disconnect and cursor
reconnect, terminal text ordering, cancelled text flushing, rejected cancellation
and text spacing across resumptions. The store read-count regression checks a
100-event history. No human vault, real installed-skill scan, live model request,
package installation, push or merge occurred. Build/offline adapter checks do not
claim live engine compatibility or participant validation.

#### Task 5 independent-review fix 1 — transport replay and owner cancellation acknowledgement

Observer reconnection now retries rejected fetches, errored stream reads and
incomplete terminal JSON fragments from the last successfully delivered cursor.
Retry waits and active stream observation detach on abort. Authentication,
complete-event schema, cursor and owner failures remain fatal, and observation
never sends action requests. Terminal snapshot cursors are still drained.

Cancellation of a live owner now commits a private journal intent while retaining
the existing status. New attempts, reserved-attempt claims, steps, lease claims,
resume and non-cancellation lifecycle transitions are fenced by that authoritative
intent. The owning lease polls intents every 50 ms, aborts its root signal before
waiting for text spacing, flushes accepted snapshots and acknowledges the terminal
cancelled status. Lease renewal writes retain their one-second cadence. Dead-owner
recovery finalizes the intent without dispatch or usage refunds. Repeat cancellation
after acknowledgement cannot reopen a pending intent while the owner unwinds.

The private intent is an optional UUID in WorkflowJournal. Public ToolRunDto adds
only `cancelRequested: boolean`; true supports "Stopping…" until acknowledgement,
then false. RunStatus/action request variants are unchanged. Start responses also
use the authoritative projection so idempotent starts reflect pending cancellation.

| Check | Result |
| --- | --- |
| I1/I2 focused RED | 5 failed/55 passed: rejected fetch, errored stream, partial EOF, retry abort and non-owner pending-text loss |
| Terminal-repeat RED | 1 failed/21 skipped: acknowledged cancellation became pending again with a new action ID |
| Final API/recovery GREEN | 62 passed across 2 files; pristine output |
| `npx tsc --noEmit` | Exit 0; 3.37 seconds |
| `npm run lint` | Exit 0; baseline ConnectAiCard warning and generated-cards Babel note only; 15.62 seconds |
| `npx vitest run` | 2833 passed/19 gated skips; 282 passed/7 skipped files; command 30.30 seconds |
| Final isolated `npm run build` | Exit 0; compiled in 5.6 seconds; TypeScript 3.2 seconds; all workflow routes compiled |
| `git diff --check` | Exit 0 |

Full gate: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-5-fix-1`.
Exact logs/results: `verification/task-5-fix-1/` in the local SDD directory;
focused logs: `task-5-fix-1-{red,green,terminal-repeat-red}.log`.
The build used the documented elevated path, `.next-modular-task-5-fix-1`, disposable
`/tmp/scispark-modular-task-5-fix-1/{vault,profiles}` roots and scheduler off.
`task-5-fix-1-build/` preserves full logs, exit status, current-task backups and
validated generated-config cleanup; the user's normal build output was preserved.

The actual two-process regression pauses its child coordinator immediately after
accepting buffered text (SIGSTOP), requests cancellation from the other runtime,
proves the intent is pending with no persisted text/terminal event, then resumes
that owner (SIGCONT). Its signal aborts and the final text precedes cancelled.
Separate dead-owner coverage denies new/reserved dispatch and checkpoint work,
then kills the disposable owner and verifies cancellation without replay while
retaining cumulative usage. Deterministic rejected-fetch/errored-stream/mid-line
replay delivers sequences exactly once and never calls actions; auth/owner/schema
failures and retry detachment are covered. Public pending projection is read-only
and excludes the private operation/lease IDs. No live models, human vault,
installed-skill scan, package installation, push or merge occurred.

### Task 6 — artifacts and authorized wiki saves

Artifacts now have bounded, host-allocated content identities (25 MiB maximum),
atomic binary-then-metadata publication, SHA-256 verification, profile/vault owner
checks, and symlink guards. Replayed identical publication repairs a missing run
reference without creating another artifact. Authenticated artifact GET returns
attachment-only bytes with `nosniff`, `no-store` and sandbox CSP; filenames use
UUIDs, never untrusted titles. Existing generic private-state guards already deny
all artifact/output-journal paths; new regressions extend that coverage.

`WorkflowIO.publishArtifact(input)` publishes and emits an artifact event.
`WorkflowIO.submitWikiProposal({artifactIds, changes})` is the Task 10/14 handoff:
DeepSpark/hosts submit their complete proposed before/after changes without applying
them. The server validates the exact artifact selection, wiki schema routing,
frontmatter, source-reference preservation and protected paths, then persists one
immutable proposal with a host-allocated changeset ID. An explicit subset cannot
silently apply a full proposal. Native evidence limitations must remain in its
proposed page content; publication does not upgrade evidence quality.

Explicit save accepts artifact IDs and an operation UUID only. Without a proposal,
supported Markdown/papers/BibTeX outputs become provenance-bearing new note pages
using the existing `serializeDocument` and schema routing. File/HTML/SVG selections
fail explicitly, and original papers remain untouched. Both explicit and authorized
automatic saves persist the same stable changeset identity before `applyChangeset`.
A crash after the audit commit is reconciled once, including after subsequent user
edits or undo; retries never reapply the change. Existing persisted undo remains
divergence-aware. Partial mutation without an audit fails closed through the
existing conflict checks rather than overwriting user data.

The coordinator records output completion before saving and only triggers automatic
writes for captured `update_wiki`. Recovery after that checkpoint skips adapter/model
preflight and replay, then finishes the authorized save under the existing lifecycle
lease lock. `outputs_only` does not automatically save. Cancellation intent still
belongs to the original journal and fences owned publication/proposals/saves; usage,
allowance, dispatch accounting and public cancellation projection are unchanged.

| Check | Result |
| --- | --- |
| Focused RED | New artifact suite failed on missing implementation module; existing vault suite 79 passed |
| Final focused GREEN | 138 passed across artifact, real HTTP, recovery and vault API suites |
| `npx tsc --noEmit` | Exit 0; 3.66 seconds |
| `npm run lint` | Exit 0; 16.15 seconds; existing ConnectAiCard warning and generated-card Babel note only |
| `npx vitest run` | 2852 passed / 19 gated skips; 284 passed / 7 skipped files; command 30.62 seconds |
| Isolated production build | Exit 0; compilation 9.8 seconds, TypeScript 8.3 seconds, 66 pages; both new routes included |
| `git diff --check` | Exit 0 |

Phase-6 evidence is a real loopback HTTP integration test using the actual Next
route exports, real disposable profile/session/context/storage, and a deterministic
registered adapter. It exercises authenticated start, disconnected observation,
continued completion, allowance refusal before dispatch then extension/resume,
retrievable artifacts, hostile HTML download headers, duplicate explicit save and
persisted undo. Separate filesystem-reopen recovery tests cover detached authorized
completion, publication/completion-before-save, and applied-audit-before-settlement
without adapter replay or duplicate mutation. This does not claim a production Next
browser or process-restart acceptance gate; Task 19 owns that layer.

The sandbox denied loopback binding (`EPERM`); scoped elevated focused/full tests
passed. Subsequent full gates include this test-only listener and need the same
local binding permission on this host. The isolated build used
`.next-modular-task-6`, `/tmp/scispark-modular-task-6/{vault,profiles}` and scheduler
off. Task-local config backups prove only the generated dist includes/imports were
restored; the normal build output was preserved. Exact logs are in local SDD
`verification/task-6/` and `task-6-build/`. No human vault, live model, real installed
skills, package installation, push or merge was used.

#### Task 6 independent-review fix 1 — shared transaction and interrupted-apply recovery

The review found two concrete gaps in the initial save implementation: mixed or
all-after pages without an audit could not recover, and distinct run/storage locks
could both accept the same before-image. These are now fixed in the shared changeset
boundary. Every ordinary apply, revert, persisted undo and workflow save uses the
same storage-backed `changeset-mutations` lock for its canonical vault. Lock order
is workflow journal lock first, vault mutation lock second; shared transaction code
never takes a workflow lock.

Workflow saves validate all fresh before-images under that lock before writing a
strict private `.scispark/changeset-transactions/pending.json` intent with the owning
run and exact changeset. Matching after-images alone never establish ownership.
Before any subsequent changeset mutation, an owned pending intent is reconciled:
known before/after states complete missing page writes and the same audit; an exact
existing audit settles the intent without reapplication. Ordinary in-process
rollback remains intact. Failed rollback or process death retains the intent.
Normal persisted undo can recover the audit and then undo the complete change.

Real third-state edits are neither overwritten nor discarded. The preserved intent
and output journal retain recovery images; `changeset_recovery_conflict` identifies
the owning run, changeset and affected paths. Workflow HTTP responses expose those
fields with 409, and automatic coordinator recovery emits the specific error and
requires attention. File/list APIs deny the new transaction namespace and its
normalized/symlink aliases. This supersedes the initial report's partial-write
limitation: safe owned mixed/all-after states now recover, rather than merely fail
closed. Actual divergence still requires an explicit resolution.

| Check | Result |
| --- | --- |
| Behavioral RED | 3 failed / 36 passed: mixed/no-audit, all-after/no-audit, and both concurrent saves falsely successful |
| Final focused GREEN | 206 passed / 6 files, including existing lazy-profile creation, rollback and undo |
| `npx tsc --noEmit` | Exit 0; 3.35 seconds |
| `npm run lint` | Exit 0; 16.01 seconds; baseline warning/Babel note only |
| `npx vitest run` | 2866 passed / 19 gated skips; 284 passed / 7 skipped files; command 31.28 seconds |

Focused cases use real disk reopen and separate storage contexts: mixed two-page
and all-after/no-audit recovery, coordinator recovery without adapter replay,
normal undo, genuine user divergence with retained intent, workflow-vs-workflow
and workflow-vs-ordinary changeset concurrency, refusing unowned after-images,
strict intent validation, exact audit content validation, and actionable HTTP
conflict metadata. The first master run caught a missing-root compatibility issue
in the initial symlink check; the guard now preserves lazy vault creation and
checks transaction/target paths after the lock creates the root. That failing
master output is retained in `verification/task-6-fix-1-initial/`.

Final command: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-6-fix-1`.
Exact RED/GREEN/master outputs are in `verification/task-6-fix-1/` in the local SDD
folder. Full tests use the scoped elevation required by the existing loopback phase
harness. No human vault, provider, real installed skills, push or merge was used.
The final isolated production build also passed (compile 9.8 seconds, TypeScript
8.3 seconds, 66 pages) using `.next-modular-task-6-fix-1`, disposable
`/tmp/scispark-modular-task-6-fix-1/{vault,profiles}` and scheduler off. Exact logs,
exit status, fresh config backups and verified generated-config cleanup are in
`task-6-fix-1-build/`. `git diff --check` passed.

### Task 7 — bounded research package acquisition and immutable imports

Added strict import/staging/preview/recipe contracts and bounded local-folder,
agent-folder, ZIP and GitHub acquisition. GitHub resolves an exact commit before
archive download, validates each redirect and pins a public IPv4 DNS result.
Authentication is transient and limited to the API host. Acquisition never runs
hooks, package instructions, validators or setup commands.

Archive validation checks portable paths, case-folded aliases, duplicate entries,
local/central ZIP consistency, integrity and actual streamed byte limits. Internal
file and directory symlinks are copied as regular content with root confinement,
cycle detection and normal entry/expansion budgets. Traversal, outside-root links,
nested archives and unsupported formats reject. All fixtures are disposable.

Inspection recognizes SKILL.md and the four specified plugin/marketplace metadata
paths. It exposes editable inferred proposals when skill metadata is absent,
requires complete capability/setup review and emits new immutable refs after
edits. Setup recipes are separate from instructions. JSON schemas are bounded and
converted with installed Zod `fromJSONSchema`; external refs, regex validators and
unsupported constructs reject. Commands/dependency setup remain explicit
unsupported requirements for Tasks 8/9.

Committing an import snapshots only selected entrypoints and their declared,
conventional/transitive resource closure, plus notices. File hashes and reviewed
metadata/dependency locks define immutable digests. Profile-local catalogs survive
reopen, preserve earlier versions, and keep other profile bindings/settings apart.
Dependency resolution rejects cycles, missing refs and version conflicts; builtin
helpers retain their exact native refs and are not stored as imported objects.
Only declared frozen helper candidate slots permit selection. Runtime parent-step
choice persistence remains the runner's responsibility. No executable adapters are
registered during import and no active run is upgraded.

| Check | Result |
| --- | --- |
| Initial RED | Missing `../acquire` before implementation |
| Directory-alias RED | 2 failed / 30 passed, proving missing safe directory-link support |
| Final focused GREEN | 48 passed / 2 files (32 imports, 16 browser-purity checks) |
| `npx tsc --noEmit` | Exit 0; 3.43 seconds |
| `npm run lint` | Exit 0; 15.88 seconds; baseline warning/Babel note only |
| `npx vitest run` | 2900 passed / 19 gated skips; 285 passed / 7 skipped files; 34.44 seconds |

Final command: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-7`.
Exact logs and the complete report are in the local SDD `verification/task-7/` and
`task-7-report.md`; an earlier successful pre-directory-fix gate is retained at
`verification/task-7-before-directory-links/`. Self-review preceded the final gate
and fixed directory aliases, ancestor casing, JSON-only inputs, snapshot digest
coverage and native-helper catalog ownership. `git diff --check` passed.

The first scoped gate attempt was not executed because automatic approval review
hit a model-capacity error; an identical scoped retry succeeded. The scope was the
existing disposable loopback test harness. No real installed-skill scan, personal
vault, live model, actual package command, push or merge was used. No production
build was needed. ZIP64/encrypted/multidisk/nested archives and special files, plus
IPv6-only acquisition, remain explicit unsupported states. Inspection readiness
is not a claim that runtime isolation or dependency installation has completed.

#### Task 7 independent-review fix 1 — truthful requirements, complete references and safe reads

Host-detected plugin/external-source requirements now live in strict host-owned
metadata outside editable package proposals. Initial previews and repeated review
edits retain those detections, merge them into requirements/readiness, and include
them in immutable snapshot identity. This inspection phase has no host-validated
resolution API; clearing an editable setup array cannot claim support.

The selected resource closure now follows full, collapsed, shortcut and image
Markdown references, including normalized labels, space-containing destinations
and transitive `.md`/`.markdown` references outside conventional folders. Unused
definitions and code examples do not add resources. Unsupported reference syntax
and oversized Markdown fail explicitly instead of producing incomplete snapshots.
Local FIFOs, internal FIFO symlinks and direct ZIP FIFO selections reject before
open; nonblocking/no-follow descriptor opening plus `fstat` also protects against
replacement between path inspection and open. Test cleanup leaves no blocked I/O.

R17 adds bounded transient query data only for validated codeload archive
redirects, preserving HTTPS/DNS/private-address checks and API-only authorization.
Source URLs remain strict. Request, body, DNS and invalid-redirect errors are
sanitized; fixture query/API secrets never enter persisted runtime data.
[GitHub's official ZIP API documentation](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip)
confirms redirects and expiring private links. Exact live signature formatting
and actual private-repository acquisition remain unverified; all transport tests
use fake DNS/HTTP and fixture credentials. No private repository was accessed.
The fixture README now consistently describes file and directory symlink copying.

| Check | Result |
| --- | --- |
| Behavioral RED | 6 failed / 32 passed: erased requirements, omitted references, three FIFO stalls and signed-query rejection |
| Final focused GREEN | 68 passed / 2 files (52 imports, 16 browser-purity checks) |
| `npx tsc --noEmit` | Exit 0; 3.60 seconds |
| `npm run lint` | Exit 0; 16.13 seconds; baseline warning/Babel note only |
| `npx vitest run` | 2920 passed / 19 gated skips; 285 passed / 7 skipped files; 30.93 seconds |

Self-review preceded the final command:
`python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-7-fix-1`.
Exact outputs and the appended report are in the local SDD
`verification/task-7-fix-1/` and `task-7-report.md`. `git diff --check` passed.
The master gate used established scoped elevation for disposable loopback tests.
No build, live provider, actual package execution, human vault, installed-skill
scan, push or merge was used. The original Task 7 commit is amended with its
parent, subject and Codex attribution preserved. Runtime concerns remain in
Tasks 8/9/10/13/14.

#### Task 7 independent-review fix 2 — separate shortcut references

The remaining closure defect was whitespace consumption between reference labels:
separate shortcuts could be interpreted as one full reference, dropping the first
resource. The second label must now be immediately adjacent. Spaces, tabs, line
breaks and paragraph boundaries preserve independent shortcuts, consistent with
[CommonMark's full-reference rule](https://spec.commonmark.org/0.31.2/#full-reference-link).

Seven tests inspect the actual committed snapshot with resources outside
conventional folders. They cover paragraph/same-line/CRLF boundaries and retain
adjacent full-reference and collapsed-reference behavior. Behavioral RED was
**5 failed / 54 passed**, with `first.txt` absent from each affected snapshot.
Final focused GREEN was **75 passed / 2 files** (59 imports, 16 purity checks).
Self-review confirmed only the adjacency check, its comment and these regressions
changed; previously approved requirement, FIFO and redirect fixes were untouched.

Final command:
`python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py task-7-fix-2`.
TypeScript passed (3.41 seconds), lint passed (16.17 seconds; baseline warning
and Babel note only), and Vitest passed with **2927 passed / 19 gated skips**
(285 passed / 7 skipped files; 31.09 seconds).
Exact outputs and the appended report are retained in
local SDD `verification/task-7-fix-2/` and `task-7-report.md`.
`git diff --check` passed. Scoped execution supports existing disposable loopback
tests only. No build, live call, private repository, installed-skill scan, human
vault, subagent, push or merge was used. The task commit is amended while
preserving its original parent, subject and Codex attribution.
