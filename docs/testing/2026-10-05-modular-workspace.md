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


### Task 8 — enforced command isolation and process ownership

Pinned `@anthropic-ai/sandbox-runtime@0.0.78` after verifying the exact published
archive SHA-512; installed with scripts disabled. A secret-free trusted worker
owns each invocation, with deny-all host reads, explicit immutable package and
research projections, invocation output/temp write grants, and explicit denial
of the runtime's shared `/tmp/claude` exception. Setup scopes have no research
grant and separate registry-domain rules. Run/setup contexts and invocations are
strictly validated; package bytes and owning profile/run references are checked.
Nonempty connection IDs remain unavailable until Task9 supplies its authenticated
broker. No unrestricted execution fallback exists.

Task8 owns run command reservation/claim/settlement; Task10 must not reserve it
again. Setup journals retain call counts and cumulative active time across a
stable setup ID: pending/unknown work holds its requested deadline, while known
outcomes settle actual elapsed time and release unused time. Limits remain
60 commands/1800 active-or-held seconds per setup,300 seconds/2 MiB per command.
Task9 owns environment lifecycle and ready publication. Profile commands serialize;
setup stages may persist across its invocations, while research-run output/temp
roots remain invocation-specific.

Actual disposable macOS probes passed filesystem/read-write boundaries, synthetic
host-home log and sibling-invocation write denials, the shared-temp denial,
literal argv, setup research exclusion, network denial, output cap and timeout.
The Unix sentinel listens inside the permitted output root, independently testing
socket blocking. Descendants are armed before termination checks. Final owned-handle
probes found surviving children after cancellation, parent IPC loss, detached
execution and normal parent exit. Therefore macOS readiness is **unsupported**,
and imported command dispatch is blocked. Early process-group experiments are
superseded; final code never signals remembered PIDs/groups. Linux uses the pinned
runtime's PID namespace/direct bwrap parent-death boundary and has a separate CI
probe job, but **Linux execution/CI is unrun locally**. Windows is unsupported.
No human vault/config content, real installed skills, provider calls, push or merge
were used. Platform-harness success is not platform readiness acceptance.

TDD RED: missing isolation module; focused GREEN:13 passed. Additional behavioral
RED:2 failed/10 passed for retained setup timeouts and absent observed elapsed
usage. Final regressions cover60 quick300-second-bounded steps, the command cap,
consumed active-time cap, and an uncertain300-second hold blocking retry.
Final `verify-task.py task-8`: TypeScript passed3.64s; lint passed16.09s with only
the baseline ConnectAiCard warning/Babel note; Vitest **2940 passed/20 gated skips**,
286 passed/8 skipped files,32.14s. The new platform test is gated in this full suite
and was separately executed against the real worker; it was not counted as an
isolation pass. Final isolated production build passed (Turbopack6.0s, TypeScript3.0s,
66 static pages). All7 tool-route traces include worker, runtime/vendor assets and
runtime dependencies. Build-only tsconfig/next-env changes were compared and restored;
normal `.next` and running servers were preserved. `git diff --check` passed.
Full platform evidence, RED/GREEN logs, gate outputs, build/tracing evidence and
precise downstream paths/interfaces are in local SDD `task-8-report.md` and
`verification/task-8/`.

### Task8 review fix1 — private registry resolutions (2026-10-05)

Added explicit RFC1918, CGNAT and IPv6 ULA `deniedResolvedAddresses` to both
run/setup policies, retaining the pinned runtime's mandatory loopback,
link-local and metadata denials. Exact installed-runtime guard regressions
failed before the fix (3 failures/14 passes), then passed for private ranges,
embedded IPv4 forms, mandatory denials and checked public DNS answers.
Final focused checks:21 passed/1 gated platform skip.

The actual worker's setup proxy returned guard-specific HTTP403 for GET and
CONNECT to fixed RFC1918/ULA/CGNAT/loopback destinations, with zero sentinel
target connections. This uses deterministic DNS fixtures for fixed
`*.scispark.invalid` names inside the trusted probe worker, while preserving
the real pinned sandbox/proxy/address guard; it does not test external DNS.
No hosts edits or broad loopback grants were added. Strict invocation/recipe
schemas and normal dispatch reject probe controls;3 actual worker tests reject
normal-mode probe controls before runtime initialization. No caller-supplied
DNS mappings or inherited environment switch exists.

Final actual platform harness:4 passed in14.60s, including the enforced proxy
regression. macOS readiness remains **unsupported**: descendants survived
cancellation, IPC loss, detached execution and normal exit; kernel ownership
is unavailable. Linux execution/CI remains **unrun**, not passed.

After self-review, final `verify-task.py task-8-fix-1`: TypeScript exit0(4.19s),
lint exit0(18.70s; existing warning/Babel note), Vitest exit0(36.89s wrapper;
35.52s Vitest), **2948 passed/20 gated skips**,287 passed/7 skipped files.
Final isolated production build exit0: Turbopack11.2s, TypeScript9.8s,66 pages.
All7 tool-route traces include the worker, runtime/vendor assets and dependencies.
Verified and restored only generated tsconfig/next-env edits. These fix1 gates
supersede the pre-fix gate totals above. Evidence: local SDD
`verification/task-8-fix-1/`; full rationale/limits in `task-8-report.md`.

## Task 9 — managed environments and scoped connections (2026-10-05)

Implemented profile-owned durable setup IDs, reviewed immutable dependency locks,
exact official Node22.22.0 / CPython3.12.12 artifact pins, Task8-isolated extraction,
Python source build/venv and npm ci --ignore-scripts, content-verified atomic ready
records, and explicit idempotent staging discard. Discard preserves every command
attempt and charges an uncertain attempt at its held bound; no usage reset.
Missing host build prerequisites are actionable needs-setup. Existing user/global
environments are never adopted or modified.

Run creation now captures the fixed dependency plus declared helper-candidate
closure, all applicable prepared environment refs, and non-secret connection
revisions before persistence. Every candidate must be prepared before research
starts (R23). Recovery validates those exact captured records; current selection
cannot retarget a run. Task10 supplies instruction/command execution; Task13
retains the ready records and their stable staging roots.

The Semantic Scholar broker uses the pinned runtime's external HTTP proxy port,
registered as a live profile/run capability. It validates the complete virtual
GET request, rejects CONNECT/other destinations/redirects, pins public IPv4 DNS,
and inserts the owning storage's current source key host-side. Commands receive
only opaque handles. General localhost/Unix socket access stays disabled and the
runtime's SOCKS path remains deny-all. Other services, unadapted CLIs and internal
model calls remain unsupported; model traffic belongs to Task3.

Verification: setup RED reported the absent setup module; focused GREEN covers
10 setup and8 connection tests, including real disposable HTTP listeners with
mocked DNS/upstream, plus existing command/recovery regressions. Required full
gate:2966 passed/20 gated skips; TypeScript and ESLint passed (the existing
ConnectAiCard warning only). Isolated Next16.3.2 build passed,66 pages; all7 tool
route traces retain worker/runtime dependencies. The initial build exposed a
newly reachable worker-path bundling issue; narrow Turbopack runtime-path ignore
annotations fixed it without changing command behavior. Pre-build config bytes
were verified/restored. Exact evidence: local SDD task-9 report and verification/
task-9{,-final} directories.

These are deterministic lifecycle and broker fixtures, not actual managed runtime
installation or authenticated-service acceptance. macOS remains unsupported under
Task8's descendant-lifetime gate; Linux actual execution, CPython compilation,
real npm/pip setup and sandbox-to-broker transport acceptance are UNRUN. Official
metadata/checksums were read; no runtime archive was installed in a human profile,
no live source/model request was sent, and no user skills/vault/credentials were
accessed. No push or merge.

Task9 independent-review fix1: reviewed Python/python3.12/pip setup steps now use
the populated venv interpreter and PATH while retaining the same setupId and
Task8 accounting. Captured runs restore the retained toolchain pin, validating
its digest and host platform/architecture without consulting the current release
pin. Behavioral RED reproduced both failures; focused GREEN12/12 models venv
helper resolution and a changed current release with an intact captured version.
These remain deterministic execution fixtures, not real Python installation.
Final task-9-fix-1 gate: TypeScript/lint exit0 (same baseline warning),2968 tests
passed/20 gated skips. Isolated Next build exit0,66 pages, all7 tool traces retain
worker/runtime assets; generated config bytes checked/restored before the gate.
Exact report and RED/GREEN/full/build evidence remain in the local SDD directory.
Mac unsupported/Linux unrun and authenticated-service acceptance limits remain.

## Task 10 — controlled instruction execution and supporting skills

Added bounded typed host actions, schema-validated durable helper frames/choices,
paged required-resource reads, sanitized readonly wiki/chat/project projection,
and separate public synthesis using actual provider onText callbacks. All model
steps retain Task3 root accounting; command reservation remains solely Task8.
Per-parent declared edges/slots enforce invocation authority within the captured
closure. Artifact publication and complete wiki proposals use Task6 IO.

Reviewed runtime executionCommands now select fixed prepared Node/Python recipes;
Node scripts resolve from the prepared project and Python uses the captured venv.
Canonical endpoint/provider/model catalog quotes are captured in immutable run
models; unknown/custom endpoints need setup before spending. Optional explicit
executeHelper adapters receive the unchanged root and validated frame/tool/input;
committed opaque results replay, unknown results require reconciliation. Task11/14
implement supporting command/native adapters; Task17 owns user choice and uncertain
outcome routes. No ordinary adapter fallback or provider CLI tools were enabled.

TDD RED: missing agent module. Focused GREEN:94/94 across host, usage and import
suites, including18 new host tests; deterministic provider calls exercise actual
JSON decisions, journal accounting and onText streaming. Prepared command transport
and native helper results are labeled fixtures. Fresh storage/context recovery
covers persisted helper enter/result and unknown outcomes. Overflow preserves all
read pages and stops explicitly instead of silently dropping resource context.

Required task-10 gate: TypeScript exit0 (4.70s), ESLint exit0 (19.04s; existing
ConnectAiCard applyPreset warning only), Vitest2986 passed/20 gated skips across
290 passed/7 skipped files (45.54s). Isolated Next16.3.2 build passed,66 pages;
current-task generated tsconfig/next-env changes were inspected and exact prior
bytes restored before the gate. Full local evidence: SDD task-10-report.md and
verification/task-10. No broad suites repeated after successful final checks.

Mac command execution remains unsupported; Linux/real installed-tool transport,
actual package installation and sandbox-to-broker acceptance are UNRUN. No live
provider/source calls, human vault/profile/credentials, real installed-skill scans,
push or merge. Catalog quote dates are provenance, not newly verified market prices.

Task10 independent-review fix1: production preparation now treats an empty native
engine list as unrestricted, while an explicit incompatible list rejects before
run persistence. Supporting instruction roots exercise both paths through the real
preparation resolver and startRun. Completed synthesis now drains live callback
writes, persists authoritative returned text, emits the root snapshot and then
retires its frame. Cached crash replay restores a complete answer from a prefix;
a no-callback provider also publishes its final result. Both retain exactly the
original decision+synthesis calls/reservations; actual live streaming still passes.

Behavioral RED reproduced3 failures; focused GREEN34/34 across agent/setup suites.
Final task-10-fix-1 gate: TypeScript exit0/4.32s, ESLint exit0/19.01s (same baseline
warning),2990 passed/20 gated skips,290 passed/7 skipped files,40.47s Vitest.
Isolated Next build exit0,66 pages; generated config bytes inspected/restored before
the gate. Full report and exact RED/GREEN/build/gate outputs remain in the local
SDD task-10 report and verification/task-10-fix-1. Existing real runtime/provider
limitations remain unchanged; no new live/source/user-data calls or publication.

## Task 11 — OpenCite supported slice (R27)

Pinned `research-skills` source revision
`f0219bde233abb44d8a0c5d73f41ea27073e1493` and independently downloaded/hashed
OpenCite 0.5.4 wheel `4c8266dc371cd30b894ffbfb78ea642271762cce008f783af63ac884a0dbad84`.
The original skill and its three linked references plus BSD-3-Clause/MIT notices
are preserved. A no-build metadata resolution pins 49 transitive dependencies,
including `markitdown[pdf]` (OpenCite's extra alone omits the local PDF parser).
Exact dependency license metadata accompanies the catalog. Lock target is
CPython 3.12 / Linux glibc 2.28 x86_64; wheel hashes are enforced by existing
binary-only Task9 preparation. Metadata resolution is not installation evidence.

Supported production operations are Semantic Scholar search, exact observed open
PDF retrieval, local Markdown conversion, and BibTeX. A versioned reviewed Python
wrapper uses the pinned client/parser and JSON/BibTeX formatters, explicit
`Config()` and `converter="markitdown"`. It never loads ambient user config or
Mistral credentials. Catalog metadata/input advertises this limited slice;
original broader instructions are retained as reference resources only.

The catalog stages verified bundled files into the ordinary inspection/review/
import flow; it does not install, enable, or execute on discovery. The registered
workflow adapter validates exact package/recipe/file identities, uses the captured
venv/provider/connection root, and supports explicit helper frames with stable
frame-scoped IDs and unchanged root IO. Task8 remains sole command accounting
owner. Dynamic readiness is exported for the later Tools integration.

The existing inspected virtual-HTTP broker now grants document requests only
from successful validated source records, scoped to its owning profile/run and
live instance. It pins public IPv4 DNS at connect time, bounds each document at
512 KiB/30 seconds, caps requests, sends no source credentials to publishers,
and rejects redirects. Arbitrary command/model URLs cannot grant access. Grants
expire on broker close/restart; each new command must search again. An opaque
interruption remains uncertain and cannot silently repeat the command to regain
access. Original DOI/URLs survive normalization. An advertised inaccessible PDF
stays abstract-only; failed conversion still preserves the accessible PDF.

Focused deterministic tests: normalization/catalog/import/helper orchestration,
actual local broker with fixture upstream/DNS, invalid records/URLs, cross-run
and restarted grants, private DNS, redirects, byte ceilings, cancellation, and
provenance. Synthetic worker orchestration is labeled separately. The opt-in
`opencite-worker.test.ts` gate uses actual Task9 preparation/Task8 worker, exact
CLI `--help`, the production adapter and deterministic source fixtures. It is
UNRUN here: Mac descendant ownership remains unsupported; Linux actual execution
is not established. A separate `SCISPARK_OPENCITE_LIVE=1` mode requires
`SCISPARK_OPENCITE_REAL_WORKER=1` plus an explicit disposable test S2 credential;
it requests search/full text/BibTeX and no LLM. This live mode is also UNRUN.
No package code was executed outside the worker, and no real source/model call,
human vault/profile/key access, global package install, push or merge occurred.

Isolated build passed with `.next-modular-task-11`, disposable vault/profile
roots, scheduler off. Exact pre-build `tsconfig.json` and `next-env.d.ts` bytes
were restored after verifying only generated dist substitutions. All seven Tools
route traces include the reviewed Python wrapper, lock and original skill.
Final gate ran exactly once: TypeScript exit0/3.94s; ESLint exit0/18.17s
(existing ConnectAiCard applyPreset warning and generated-card Babel note only);
Vitest exit0/36.07s wrapper,34.96s suite,2999 passed/21 gated skips across
291 passed/8 skipped files. Focused tests passed17 with1 explicit acceptance
gate skipped. `git diff --check` passed. No broad suite followed this success.

### Task 11 independent review fix 1 — inert HTTP provenance

Important1 reproduced: an otherwise valid search result containing an HTTP paper
or PDF reference failed whole-envelope validation, including search-only mode.
Shared inert source-reference validation now accepts original HTTP/HTTPS URLs.
Requested unavailable HTTP documents retain their URLs and abstract-only access;
successful HTTP document content is still rejected. The actual broker remains
HTTPS-only, with all existing credential, redirect and public-DNS guards unchanged.

Focused command: `npx vitest run src/lib/extensions/__tests__/opencite.test.ts
src/lib/extensions/__tests__/connections.test.ts`. RED:2 expected normalization
failures/19 passed. GREEN:21 passed across2 files,1.16s. Added a real loopback broker
regression with deterministic upstream data proving HTTP provenance survives its
source response while attempted HTTP document retrieval gets403 and no additional
upstream request. No package execution or real source request occurred.

Fix-round isolated build passed using `.next-modular-task-11-fix-1`, disposable
vault/profile roots and scheduler off. Exact task-local pre-build generated
configuration bytes were restored; all7 Tools traces retain the wrapper/lock/skill.
Final fix gate ran exactly once: TypeScript exit0/7.48s; ESLint exit0/18.49s
(existing warning/Babel note only); Vitest exit0/37.53s wrapper,36.30s suite,
3003 passed/21 gated skips across291 passed/8 skipped files. Build compilation
11.7s, build TypeScript10.8s,66 pages. `git diff --check` passed; no additional
broad suite followed these successful gates. Real-worker/live acceptance remains
UNRUN with fail-closed platform readiness preserved.

### Task 13 — manual updates, retained versions and rollback

Implemented strict idempotent binding/update/rollback/disable/remove actions and
native Tools routes. Opening Tools checks only approved remote commit metadata,
at most once per origin/ref per 24h; explicit checks stage content. Local/agent
checks require renewed exact-original-package consent and the Task12 filtered
reader. Check never enables/installs. Update application prepares snapshots and
the complete dependency/helper closure before switching atomically; failed setup
preserves the old binding. Rollback restores a retained compatible version and
saved per-tool overrides without rewinding research or any captured run state.

R29 binds management receipts to the same atomic ProfileTools write as each
binding mutation. Strict public-safe results and operation hashes prevent replay
retargeting after response loss. The 10,000 receipt cap reports actionable
management-history-full without eviction, run cancellation or read failure. R30
preserves reviewed adapter field customizations only when the incoming inspected
field equals its original inspected value; changed source fields win. Resource
closure/digests and dynamic readiness are recomputed, with normal explicit review
before application. Missing baseline/source authority requires explicit re-import.
A normal explicit re-import keeps an existing pin and enabled binding consistent.

Disable/remove both return decision-required for active/recoverable root/helper
runs. Finish prevents new starts and retains accepted runs; cancel waits for actual
acknowledgement and lease release. Interrupted accepted start intents are restored
under coordinator exclusivity before this decision, without dispatch. All package,
environment/configuration/run/artifact records are conservatively retained; no GC
is implemented, so disk usage can grow. Failed-update GET state provides the
actual prepared ref and redacted setup ID/state/reason for the explicit Task9
acknowledge-and-discard action; no usage reset or full environment/path disclosure.

Focused RED: absent module; expanded disable decision regression; separate durable
start-intent regression (20 passed/1 failed). Final focused GREEN:114 passed across
four files, including22 Task13 cases,3.77s. Cases cover source consent/publication
expiry, merged proposal provenance, unchanged version text, two profiles, failed
setup, old captured runs and saved artifacts, real coordinator ownership with an
inert imported adapter, cancellation release, strict routes/redaction and atomic
receipt crash replay/cap. Logs retained in verification/task-13/.

Isolated production build passed in23.38s with .next-modular-task-13,
disposable /tmp/scispark-modular-task-13/{vault,profiles}, scheduler off:
Turbopack10.3s, TypeScript9.0s,67 static pages. Fresh task-local configuration
backups were compared against generated dist-only changes and exact bytes restored.
New dynamic tool/versions routes are included. Final full-gate results follow.

Actual imported-command/OpenCite worker acceptance remains UNRUN/unsupported on
this macOS host; Linux/runtime installation/installed CLI/broker/live gates are
not established by these deterministic fixtures. No sandbox readiness bypass,
package execution outside the supported worker, live model/source request, real
vault/profile/auth/key/home/agent scan, push, merge or PR occurred.

The first full gate caught3 native-only catalog API regressions (3045 passed,
21 skipped): Tools GET unnecessarily opened import storage for refs already in
the native registry. Lookup is now lazy for unresolved refs. A new test also
proves a disabled, unpinned imported binding loads from durable storage with no
in-memory registration. Focused affected API+version tests pass46, including23
Task13 tests,6.45s. Original task-13 failure logs remain intact; necessary final
build/gate retry evidence is under verification/task-13-final/.

Authoritative Task13 final gate: production build exit0/22.54s, compile9.9s,
build TypeScript8.8s,67 pages; exact generated-config restoration and all10 Tools
runtime traces verified. `verify-task.py task-13-final` ran once after the concrete
catalog fix: TypeScript exit0/3.96s; ESLint exit0/15.89s (existing warning only);
Vitest exit0/33.32s wrapper,32.27s suite,3049 passed/21 gated skips across
293 passed/8 skipped files. `git diff --check` passed. No further broad suite
followed these successful checks. Real-worker/live phase gates remain unrun.


## Task13 review round1 fixes (I1/I2)

Rollback eligibility now requires actual profile binding or an atomic publication
receipt. Strict optional previousTool records the departed ref in the same write;
prepared-only history cannot authorize expired/failed candidate activation.
The shared profile-tools write rejects enabled bindings for pending-cancellation
keys, covering normal re-import without adding locks. Focused regressions cover
expiry, pre-persistence failure, response-loss/revocation recovery, and a live
leased cancellation followed by re-import with no new root admitted.

Focused RED: 3 failed/22 passed; GREEN:117 passed/4 files,4.53s (25 version tests).
Required isolated build: exit0/29.94s,14.1s compile,11.3s TypeScript,67 pages;
fresh config backups restored exactly, all10 Tools asset traces verified.
Final `verify-task.py task-13-fix-1` ran once: tsc exit0/12.21s, lint exit0/20.78s
(existing applyPreset warning/Babel note), Vitest exit0/36.83s wrapper,35.47s
suite:3051 passed/21 gated skips,293 passed/8 skipped files. Raw logs and exact
configuration evidence remain in local verification/task-13-fix-1/; self-review
and git diff --check passed. Deferred M1 remains untouched. Actual imported
command/OpenCite supervised execution stays OPEN/UNRUN and Task19-owned; these
inert cancellation fixtures are not external runtime phase acceptance. No live
calls, personal state, unsupported package execution, push, merge or PR.

## Task14 native workflow integration

Four optional native adapters now use the same durable coordinator as Tools runs;
all legacy search/chat-search, Trending, Spark and paid review start/resume/revise
execution routes are guarded. Disabled endpoints return409 before calls. Core
feed/digest/retrieval and saved readers stay independent; heartbeat gates only
optional Trending. Native helper execution keeps the original root and stable
frame checkpoints. R26 empty native engines=[] permits captured engine selection.

Native ledgers remain the sole billing owners. Task3 counts every raw dispatch,
including repair/grounding, without a second Meter charge. R34 adds strict native
Meter reservations with API vs subscription billing semantics; subscription dollars
stay null while calls/time count. Reopen/lost response retains native holds and
explicit idempotent reconciliation accepts known native charges or conservative
acknowledgement. Original reservation-day billing is preserved. Native review and
local-review keep their existing ledgers. Generic vault GET/PUT/DELETE/list cannot
expose or alter the new native hold journal; tool-run continuation/link/receipt
paths inherit existing private namespace protection.

R32 preserves exact review_ IDs. R33 partial review choices reuse the same root,
checkpoints and cumulative usage. Keep queues saved output completion; coordinator
Task6 performs an already authorized update_wiki save, even without an observer.
outputs_only stays inert. Revisions preserve the native review/ledger and parent
version in a new envelope. Opaque interrupted revision dispatch remains uncertain.
First wrapping an approved brief rejects changed captured model/provider/endpoint;
its approved native rates remain authoritative. Cancellation fences later dispatch.

DeepSpark always publishes a validated proposal in workflow mode; Task6 owns apply.
The existing Spark card now links the real proposal artifact and offers explicit
Save to wiki with exact selection. No nonexistent wiki-page success is returned.
The narrow visual change preserves layout/tokens and has focused DOM/save tests.
Legacy progress/job observations retain coordinator ownership; reconnect does not
restart work and disconnect does not cancel it.

Initial caller audit and RED collection failure retained in verification/task-14/.
Initial combined GREEN141tests/12files. Initial build passed29.37s with exact
config-byte restore; first master tsc/lint passed, Vitest3068passed/21skipped/2failed.
Both failed Trending field-scope fixtures lacked explicit enabled-tool context;
their full field/subfield/source assertions were preserved. Keep-partial correction
RED2fail/20pass, GREEN83/4files. Corrected build31.38s, full gate3072pass/21skip,
295pass/8skip files,50.97s suite, tsc/lint0 (verification/task-14-final/).

Final self-review closed subscription response-loss recovery, actual persisted
Meter write-response loss, opaque revision receipt loss, and private new journal
paths. Accounting RED3fail/13pass; private/revision RED5fail/106pass. Final focused
GREEN222tests/10files,10.69s, includes native/review durability/ledger/usage/recovery,
vault routes, heartbeat and Spark. Authoritative final build/master follows under
verification/task-14-accounting-final/. All fixtures disposable and deterministic;
no human vault/profile/key/agent scan or live provider/source calls. Production
browser/live and actual imported-command supervision acceptance remain UNRUN,
Task19-owned. No unsupported command bypass, push, merge or PR.

Authoritative Task14 final snapshot: isolated build exit0/28.54s, compile13.7s,
build TypeScript10.4s,67pages. Fresh tsconfig.json and next-env.d.ts backups were
compared to generated-dist changes and restored byte-for-byte. One final
verify-task.py task-14-accounting-final invocation: TypeScript exit0/3.25s;
ESLint exit0/18.92s (existing ConnectAiCard applyPreset warning/generated-card
Babel note only); Vitest exit0/47.01s wrapper,45.81s suite,3080passed/21gated skips
across295passed/8skipped files. Logs/results/config evidence remain in local
verification/task-14-accounting-final/. Final caller audit and diff-check passed.
No broad checks were repeated after this successful final gate. Scope/phase
limitations above remain: deterministic local acceptance only, no live calls or
production-browser acceptance, no push/merge/PR.


## Task14 review fix round 1 — I1–I4 (R35)

I1 now publishes a strict prepared native link before reserving root usage. Each
actual provider boundary follows: prepared link → root reserve/claim → native
owner reservation → durable dispatching marker → provider call → native settlement
→ root settlement. The three callers (Meter skill runner, API review, local review)
all enter dispatch after their native reservation is durable. Unscoped callers
receive a no-op callback, retaining native-only compatibility. Legacy links without
a marker default to dispatching and cannot authorize a refund.

Stopped-owner reconciliation releases only proven prepared attempts. Immutable
root tickets remain as not_dispatched; native rows remain as released. API cost is
zero, subscription cost remains null, and released local-review rows do not consume
the call ceiling. No Meter row is invented for review owners. A committed dispatch
marker with lost write response stays conservative even when the test provider saw
zero calls. Missing proof never authorizes release. Task17 uses the existing
reconcileNativeAccounting hook: financial uncertainty may clear while a pending
opaque checkpoint still requires an explicit decision; inspect hasUncertainWork
and lifecycle state separately. Reconciliation never retries a model.

I2 restores approval of waiting_for_setup on the same captured root and native
review after connection recovery. I3 validates exact action, native identity,
revision and eligible state under native-review-control then review-control before
publishing the accepted receipt or changing finances. Named prepare/reconcile/
publish phases preserve incomplete accepted-receipt repair. Stale or competing
actions leave native accounting, root usage and continuation bytes unchanged.
Reconciliation lock order is native-reconcile → workflow-coordinator → native
ledger locks → workflow journal; local-engine precedes ai-spend where both are
needed. The coordinator exclusion prevents a stopped root being claimed during
proof inspection; journal validation uses a raw read within its existing lock.

I4 starts optional Trending observation independently of core heartbeat work.
A durable scheduled-Trending intent/root pointer under the protected tools
namespace repairs admission response loss and reuses queued/active work. Runtime
observers are deduplicated; their success/failure is recorded by the existing
schedule ledger. waitForHeartbeatOptionalWork is a read-only test/shutdown join.
Enabled Trending queued behind a held lease cannot block consolidation or lint,
and observer reconnect cannot become another execution owner.

Focused RED:7 failed/39 passed (red.log). API-review publication extension RED:
2 failed/25 passed (review-publication-red.log). A development recursive journal
lock failure was corrected without weakening tests. Final focused GREEN:
146 passed/7 files,11.46s (focused-green.log), covering Meter/API-review/local-review
before-write and committed-then-threw faults, reopen/idempotent reconciliation,
API/CLI units, retained rows, opaque uncertainty, stale-action immutability,
same-root setup recovery, and enabled/held-lease core heartbeat success/failure.
Command: npx vitest run src/lib/extensions/__tests__/native-adapters.test.ts
src/lib/review/__tests__/integration.test.ts src/lib/review/__tests__/durability.test.ts
src/lib/review/__tests__/evaluation-ledger.test.ts src/lib/scheduler/__tests__/heartbeat.test.ts
src/lib/workflows/__tests__/usage.test.ts src/lib/workflows/__tests__/recovery.test.ts.

Self-review stayed within I1–I4 and the affected three native dispatch callers.
Required isolated build passed30.24s (compile13.1s, TypeScript12.1s,67pages), using
.next-modular-task-14-fix-1 and disposable vault/profile roots. Fresh exact config
backups were restored byte-for-byte. Source and focused evidence are retained in
verification/task-14-fix-1/. Full gate results follow. Baseline M1 remains unchanged;
M2 ordering was clarified in the touched validation/publication phases. Task19
production/browser/live/actual imported-command gates remain open. No human state,
live calls, unsupported command bypass, push, merge or PR.


Fix-round authoritative gate: verify-task.py task-14-fix-1 ran once after all
source corrections. TypeScript exit0/3.63s; lint exit0/19.76s (only existing
ConnectAiCard applyPreset warning and generated-card Babel note); Vitest exit0/
43.36s wrapper,42.04s suite:3101 passed/21 gated skips across295 passed/8 skipped
files. Exact commands, logs, results and build config-byte evidence remain in
verification/task-14-fix-1/. Final git diff --check passed. No additional broad
check followed success. Scoped build/loopback allowance was used with no approval
rejection. The14 intended fix/evidence files amend the original Task14 commit;
its exact subject, Codex trailer and parent cffa77d are preserved.


## Task14 review fix round 2 — repeated setup admission (I2 only)

A completed continuation receipt represents queue publication. It now permits
readmission only when the root is stopped in waiting_for_setup, cancellation is
absent, the exact receipt still matches the persisted native continuation, and
the native revision has not advanced. Existing native-review-control/review-control
locks protect validation and reacceptance. Native action/state eligibility is
revalidated before publishing the incomplete accepted receipt. Captured root/model
and native review identity are retained. Replaced, active, progressed and terminal
actions retain receipt idempotency; incomplete accepted receipts retain repair.
No other I1/I3/I4 behavior or execution boundary changed.

Actual repeated-disconnect regression RED:1 failed/26 filtered skips,1.54s
(red.log). Final focused GREEN:82 passed/3 files,8.54s (focused-green.log), using
npx vitest run src/lib/review/__tests__/integration.test.ts
src/lib/review/__tests__/durability.test.ts src/lib/workflows/__tests__/recovery.test.ts.
The regression performs initial failed preflight, two failed Approve retries,
restores the same provider, and completes the same root. It replays the completed
receipt during held active preflight and after terminal completion, asserting no
receipt rewrite, extra model calls or changed usage. Existing incomplete-receipt
repair and stale-action cases also passed. Narrow self-review and diff-check passed;
no broad audit or unrelated source edits. Build/master evidence follows under
verification/task-14-fix-2/. Task19 actual/browser/live gates remain open; no human
state, live calls, unsupported command, push, merge or PR.


Initial round2 build compiled but failed TypeScript because the persisted action
union includes cancel without revision (build-initial/,exit1/29.60s). Added the
explicit approve/resume predicate before inspecting revision. Exact configuration
bytes were restored even on failure. Corrected source: standalone TypeScript and
diff-check passed; focused-final.log repeats82 passed/3 files,9.27s. This concrete
type error justified the corrected build; the final master gate has not been
repeated. No source change beyond the narrow action guard.


Corrected isolated build exit0/15.33s: compile5.8s, TypeScript4.6s,67pages, with
fresh exact-byte tsconfig.json/next-env.d.ts restoration. The unchanged isolated
dist cache was reused after the type correction; vault/profile roots remain
disposable and scheduler disabled. Build logs/backups/diffs remain in
verification/task-14-fix-2/build/, with initial failure preserved separately.


Authoritative round2 final gate ran once: verify-task.py task-14-fix-2.
TypeScript exit0/3.46s; lint exit0/21.72s (existing applyPreset warning/generated
Babel note only); Vitest exit0/53.88s wrapper,52.54s suite:3101 passed/21 gated skips,
295 passed/8 skipped files. Final diff-check passed. Three intended files amend
Task14 with the original subject, Codex trailer and cffa77d parent preserved.
No additional broad verification followed success. No approval rejection occurred;
Task19 boundaries and no-push/no-merge scope remain unchanged.
