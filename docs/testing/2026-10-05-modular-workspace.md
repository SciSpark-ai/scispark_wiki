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
