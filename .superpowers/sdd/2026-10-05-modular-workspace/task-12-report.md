# Task 12 — Consented discovery from installed agents

Base: a6854958ef9b87f44f03dcb12abd92cd8958e68a on
`codex/modular-research-workspace`. Workspace `agents.md` and `project_memory.md`
were present. Read the task brief first, then global context/build notes,
workspace contracts and installed Next route-handler docs. No real agent skill
folder, agent authentication/settings/session file, user profile/vault, or model
was inspected or used. All execution fixtures use disposable temporary roots.

## Implementation and contracts

Shared strict Zod schemas define roots, grants, candidates, grant/discover/stage/
revoke actions with operation IDs, query and DTO projections. Each selected root
supplies an agent, explicit layout and absolute path. Grants canonicalize those
roots and bind profile + vault for 30 minutes; no parent or home-directory crawl
or environment-config inference occurs. Permission errors precede source reads.
The native `/api/tools/discovery` route reuses Task 5 streamed 64 KiB body bounds,
same-origin guards, session authentication, selected-profile enforcement and
sanitized errors. POST applies explicit actions with persisted operation replay
and conflicts. GET reads only existing saved results; it never discovers sources.
Replaying a prior successful grant/discover/stage cannot renew expired/revoked
consent. Candidate IDs are server UUIDs; clients cannot supply candidate paths.

Codex recognizes selected `.agents/skills`, `.codex/skills`, config `skills`, and
installed plugin metadata/cache layouts. Claude recognizes config `skills` and
recorded installation inventory paths. Custom skill collections and explicitly
selected packages/cache roots use the same bounded reader. Plugin manifests'
relative skill directories are inert data. Unsupported inventory schemas,
external metadata paths, missing helpers, protected references, special files,
directory cycles, escaping links, canonical-root retargets and quota overruns
fail closed. Authentication, sessions, history, agent settings/configuration and
known credential paths are excluded before reading/copying. Content symlinks
cannot extend broad config consent to arbitrary sibling configuration files.

A scan creates private, consent-bound Task 7 inspection snapshots from filtered
bytes. It never enables a binding, executes instructions/scripts/hooks, calls a
model or modifies source files. Local keyword ranking sorts all candidates;
non-research candidates remain visible. Deduplication hashes the full resolved
resource closure, proposal/setup and exact immutable dependency refs, excluding
origin/entry aliases. Origins survive deduplication, resource/dependency changes
remain distinct, and same-named different packages have distinct binding IDs.
Source package identities are hashed and stable across sessions; public
candidates contain relative labels rather than host paths.

`stageDiscoveredSkill` returns a one-candidate, still-unreviewed Task 7 preview.
The normal review/commit pipeline remains mandatory. Stages carry their discovery
grant ID, and Task 7 rechecks it at inspection/review/commit. Thus old previews
cannot bypass expiry or revocation. Revocation invalidates results and removes
session stages, while already committed immutable snapshots remain independently
usable. Source deletion after discovery does not make GET rescan or affect an
already imported snapshot.

R8 production integration required narrow changes to `acquire.ts` (reuse normal
bounded acquisition validation/persistence for filtered inert snapshots),
`inspect.ts` (selected entries/previews and consent checks), and `store.ts`
(shared owning-profile grant validation), besides the planned files. No workflow
readiness, platform isolation, execution or provider-selection checks changed.

## R28 and Task 15 handoff

The controller clarified that installed inventory's recorded cache versions are
valid discovery candidates without reading settings to infer source-agent
activation. **Installed/discovered never means active, enabled or ready.** Claude
uses inventory-selected versions and does not traverse stale unreferenced caches.
Codex's documented explicit cache fallback labels found packages as discovered,
not as active inventory. Every SciSpark import still requires user selection and
review. Task 15 should consume these shared actions/DTOs and preserve that copy.

Task 15 selection fields: `agent = codex | claude | custom`,
`layout = config | skills | plugin-cache | package`, `path = absolute folder`.
Grant response includes canonical roots/expiry but omits internal profile/vault
ownership. Scan/result candidates expose `id`, name/description, identity,
researchScore, origins and compatibility. Stage response omits profile/vault
ownership and carries the ordinary review preview with opaque agent provenance.
A new root or changed source requires a fresh grant/session; saved results remain
fixed within their session. Unknown or missing external dependencies remain
subject to Task 7's graph/review gates, never silently acquired.

Fixture README records official read-only format sources and distinguishes the
fixture-tested version-2 installation inventory schema from documented public
manifest formats. No claim of compatibility with every agent release is made.

## Verification and limitations

- Focused RED captured the missing discovery module failure before implementation.
- Focused GREEN: 14 discovery filesystem/API tests plus 59 existing importer
  tests, 73 passed. Actual files exercise root symlinks, duplicate origins,
  resource/dependency distinctions, sibling helpers, protected/missing/external
  references, custom roots, inventory/cache adapters, expiry/revocation,
  profile/vault isolation, opaque IDs, API guards and operation replay.
- Isolated production build passed and lists `/api/tools/discovery`. It used
  `.next-modular-task-12`, disposable `/tmp/scispark-modular-task-12/{vault,profiles}`
  and scheduler off. Initial dynamic filesystem tracing warnings were fixed with
  explicit runtime path annotations; final build has none. Exact pre-build
  `tsconfig.json` and `next-env.d.ts` bytes were restored and verified. Build logs
  and result are tracked; temporary backups are outside the repository.
- Master `verify-task.py task-12` passed once: TypeScript exit 0, ESLint exit 0
  (one existing ConnectAiCard hook warning), full Vitest 3017 passed / 21 skipped
  across 292 passed / 8 skipped files. Exact logs/results are tracked in
  `verification/task-12/`.

The supported macOS host's imported-command isolation remains unsupported and
real Linux command execution remains unrun; no readiness bypass was introduced.
No live source scan, provider call, source mutation, push, merge or publication
occurred. These are offline filesystem/API/build checks, not real installed-agent
or live-provider acceptance. Explicit revocation cleans session stages; automatic
expiry denies access but currently retains private records/stages until later
runtime cleanup. Successful POST retries are durable/idempotent; interruption
between a reversible snapshot write and its operation receipt may leave an
unreferenced private snapshot, never a tool execution or installed binding.

## Fix round 1 — review I1 consent/publication race

Read `task-12-review.md` I1 in full and the supplied disposable repro source/log.
The reproduced defect was real: commit checked consent before asynchronous work,
then could register the catalog and enabled binding after revoke had completed.
This fix changes only that authority-continuity boundary and related regression
coverage; source discovery, formats, ranking, DTOs and runtime readiness are
unchanged.

`withDiscoveryGrant` now owns the same filesystem grant lock for discovery,
revocation, Task 7 inspection, review, direct preview selection and import commit.
Commit holds it until object preparation, catalog publication and enabled-binding
persistence complete. A competing revoke must wait; if revoke wins first, commit
fails its in-lock authority check and publishes no later catalog/binding. Already
committed objects and bindings remain independently usable after revoke.

Same-grant nested calls (scan → inspect, stage → selection) use a scoped
AsyncLocalStorage guard rather than attempting the same non-reentrant filesystem
lock twice. The guard records canonical profile runtime + vault + grant identity,
rejects different-grant nesting, and expires its in-process ownership scope on
exit. Detached callbacks cannot reuse ended ownership; the filesystem lock still
coordinates independently started operations and processes.

Expiry is checked again after closure validation, after object preparation,
inside the catalog lock after its saved-state read, and inside profile-tools
after its lock/state read. Thus waiting on another store lock does not preserve
stale consent. Preview persistence also rechecks immediately before its write,
under the grant lock. Immutable object files prepared before a late expiry may
remain unreferenced. If expiry occurs after an authorized catalog write but before
the binding write, that prior catalog entry remains, but no enabled binding is
written afterward; a deterministic regression explicitly checks this safe partial
state. Expiry does not retroactively remove a previously authorized write.

### Task 13 locking and publication hooks

Acquire locks in this order: optional `discovery-operations` → grant → individual
object, imports-catalog, or profile-tools lock. Object locks are released before
catalog, and catalog before profile-tools. Never acquire a grant from inside a
profile-tools or catalog callback. Keep nested work within a grant scope sequential;
it shares that ownership, rather than representing independently competing work.
`recordImportedRefs` has an optional `beforePublish` callback executed inside its
catalog lock after reading saved state; discovery commits pass the grant checker.
The `updateProfileTools` callback performs the equivalent check inside its lock.
Task 13 should preserve these hooks/order when wrapping later binding mutations.

### Fix verification

- RED command: `npx vitest run src/lib/extensions/__tests__/discovery.test.ts`.
  Four failures demonstrated the commit/revoke barrier, post-validation expiry,
  review-validation expiry, and review/revoke persistence race (16 tests passed).
  Exact output: `verification/task-12-fix-1/focused-red.log`.
- GREEN command: `npx vitest run src/lib/extensions/__tests__/discovery.test.ts
  src/lib/extensions/__tests__/imports.test.ts`. 82 passed, including nine new
  consent-publication tests. Additional cases cover revoke winning first, expiry
  after object preparation and awaited registration, expiry before enabled-binding
  persistence, and review/stage/direct-selection final-write barriers. Existing
  imported-snapshot independence and nested discovery/staging flows still pass.
  Exact output: `verification/task-12-fix-1/focused-green.log`.
- Isolated build uses the same approved build command/environment pattern with
  `.next-modular-task-12-fix-1` and disposable
  `/tmp/scispark-modular-task-12-fix-1/{vault,profiles}`, scheduler off. The first
  build identified missing explicit `this: NodeFsVaultStorage` annotations in four
  test spies; those annotation-only corrections were applied before the final
  build/master gate. The initial log is retained separately. Both attempts
  restored exact pre-build configuration bytes.
- One master gate: `python3 .superpowers/sdd/2026-10-05-modular-workspace/verify-task.py
  task-12-fix-1`; outputs retained alongside focused/build evidence.

No live agent scan, provider/command execution, real user state, source mutation,
controller-owned code edits, new agents, push or merge occurred. Existing platform
limitations and orphan/expiry cleanup limitations remain. The original Task 12
commit is amended, preserving its original parent, title and Codex trailer.

Fix-round final results: isolated build exit 0 with the discovery route emitted
and both generated configuration files restored byte-for-byte (hash evidence in
`build-result.json`). The one `verify-task.py task-12-fix-1` invocation passed:
TypeScript exit 0, ESLint exit 0 with the one pre-existing ConnectAiCard warning,
and full Vitest 3026 passed / 21 skipped across 292 passed / 8 skipped files.
Source `git diff --check -- src` passed. Raw tool logs preserve their original
progress whitespace. Fix evidence lives in `verification/task-12-fix-1/`.
