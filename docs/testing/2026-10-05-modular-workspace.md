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
