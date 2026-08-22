# SP6 and local developer preview implementation plan

**Design:** `docs/superpowers/specs/2026-08-10-sp6-projects-history-design.md`

**Delivery:** four sequential reviewable PRs; every branch starts from updated
`main` after the preceding PR merges.

## PR 1 — SP6 foundation and safe global undo

Branch: `codex/sp6-foundation`

- [x] Record the approved SP6 design and update the stale SP5 roadmap state.
- [x] Add exact runtime changeset validation and safe ID/path handling.
- [x] Reject all private `.scispark/` targets, including forged persisted
  records.
- [x] Roll back partial apply and partial revert operations.
- [x] Derive `applied`, `reverted`, and `diverged` from current contents.
- [x] Serialize changeset operations and log appends per vault.
- [x] Add a mutation coordinator that refreshes index/log data and returns
  post-commit warnings.
- [x] Make undo accept persisted `changesetId` only; remove the force path.
- [x] Add content-free History summaries and a History changes API.
- [x] Run the full deterministic gate.
- [x] Publish draft PR #19 for review.

Acceptance: traversal IDs, private targets, forged undo contents, duplicate
paths, corrupt records, mid-apply failure, mid-revert failure, concurrent
mutations, and derived-refresh warnings have regression coverage.

## PR 2 — Real vault-backed Projects

Branch: `codex/sp6-projects`, created from merged PR 1 on updated `main`.

1. [x] Add project schemas/types, revision hashing, routed lookup, collision-safe
   creation, strict parsers, and corrupt-record isolation.
2. [x] Implement project list/detail/create/update and delete preview/commit APIs.
3. [x] Implement atomic membership add/remove while preserving unrelated
   frontmatter.
4. [x] Implement project-note CRUD as routed `note` pages with provenance.
5. [x] Replace project list/detail, paper membership, and note prototype UI with
   real API clients and honest loading/error/conflict states.
6. [x] Warn once about the three prototype localStorage keys; clear only after
   confirmation and do not migrate them.
7. [x] Run the deterministic gate and publish draft PR #20 for review.

Acceptance: stable slugs survive rename, collisions suffix safely, custom schema
routing works, stale revisions return `409`, delete-and-unlink is one recoverable
changeset, and malformed members cause no partial writes.

## PR 3 — Project chat and History UI

Branch: `codex/sp6-project-chat-history`, created from merged PR 2 on updated
`main`.

1. [x] Extend strict chat-session parsing with optional `projectId` and title
   snapshot fields while retaining old global sessions.
2. [x] Scope retrieval to current direct members; make Read Sources Only a paper
   subset and prevent deleted-project fallback.
3. [x] Enforce deterministic 16k-per-page and 64k-total context limits; persist and
   render truncated page IDs.
4. [x] Add scoped chat creation/listing to project detail.
5. [x] Make `/history` URL-addressable with Conversations and Changes tabs.
6. [x] Add change preview, applied-only Undo, and diverged-path explanations.
7. [x] Redirect `/library` to the real saved-paper Wiki shelf and delete orphaned
   library/project mock state and unsupported actions.
8. [x] Run the deterministic gate: 2,032 tests passed with 15 environment-gated
   skips, TypeScript and ESLint passed, and the production build generated all
   52 routes.
9. [x] Publish draft PR #21 for review.

Acceptance: an unassigned page is never retrieved, deleted-project transcripts
remain readable but cannot continue globally, corrupt sessions do not crash
lists, and no primary navigation route is mock-backed.

## PR 4 — Developer-preview hardening

Branch: create from updated `main` only after PR 3 merges.

1. [x] Add Playwright and a disposable-vault fixture.
2. [x] Bind preview scripts to loopback and enforce Host/Origin checks for mutations.
3. [x] Cover create project → add paper → create/edit note → scoped chat → History →
   undo, plus conflicts, corruption, deletion, and legacy-data dismissal.
4. [x] Verify export → empty-vault import restores project/chat/wiki state.
5. [x] Run the deterministic gate: 2,057 tests passed with 15
   environment-gated skips, TypeScript and ESLint passed, the production build
   generated all 52 routes, and all 4 disposable-vault Playwright scenarios
   passed.
6. [x] Prepare clone/install/run, vault location, backup, security, and known-limit
   documentation.
7. [ ] With explicit approval, run paid-provider project-chat and PDF-reader gates
   against the exact release commit.
8. [ ] With explicit approval, tag and publish GitHub prerelease
   `v0.1.0-preview.1`.

Desktop packaging and npm-registry publication remain deferred.
