# Background action recovery — October 4, 2026

## Report and diagnosis

The reported SGAD ingest finished successfully at 18:41:37 PDT, after the
18:41:09 screenshot. The resulting paper and related wiki pages were present.
The page retained stale progress and did not reload its saved-paper state.
A subsequent ingest attempt failed at 18:44:06 with `changeset contains an
invalid file change`; the earlier successful wiki entry remained intact.
Leaving a page alone was not evidence that server work had stopped.

The existing NDJSON route already kept work alive after the response reader
disconnected. Several callers nevertheless owned all progress/result state in
their React page. Reopening could not reconnect, recover Undo, or distinguish
an unfinished run from a new action.

## Change

- A shared server job registry captures the initiating vault, joins concurrent
  requests for the same action, and persists stage, completion, result and error
  in `.scispark/skill-jobs/`. Real vault instances share ownership by their
  coordination key, including across route bundles. Profiles remain isolated.
- A read-only job endpoint reconnects browsers after navigation/reload. Status
  reads do not invoke models or retry work. Existing POST formats are unchanged.
- Ingestion, digest generation, Trending, Quick/Deep Spark, deep lint and chat
  use this registry. Their main pages restore pending and terminal state.
  Chat also rejects a different simultaneous turn in the same session.
- Ingest completion reloads the paper state, exposes the saved wiki entry and
  restores Undo. A previously undone ingest is not shown as successful again.
  Digest/ingest completion events are recorded on the server, independently of
  whether the initiating page remains mounted.
- Observers detach on navigation; late paper responses cannot overwrite the
  next paper's view. Cached Trending results remain visible if reconnect fails.
- Feed and review coordinators retain their existing persistence and recovery
  rules. Their browser regressions were rerun with fixtures.

This is navigation/reload recovery while the local runtime is running, not a
service that continues after the local server or computer shuts down. Orphaned
jobs are marked interrupted, never automatically replayed. Existing review
spend reservations and explicit recovery remain unchanged. New records apply
to new runs; prior runs are not replayed or migrated.

## Verification

- `npx tsc --noEmit`: exit 0.
- `npm run lint`: 0 errors; the one pre-existing `ConnectAiCard` dependency warning.
- `npx vitest run`: 2,697 passed / 19 skipped; 272 passing files / 7 skipped.
  Twelve new cases cover job ownership, vault-instance deduplication, detached
  observers, failed/interrupted jobs, read-only clients, Trending restoration,
  and the actual ingest route through disconnect, duplicate attachment and Undo.
- Production build: `.next-background-skills`, Next 16.3.2; compile, TypeScript,
  and all 64 static pages succeeded. Generated tsconfig includes were removed
  from the source diff afterward.
- Seven production Chromium scenarios passed together (2.4 minutes):
  ingestion leave/return/reload/completion/Undo, digest leave/return/reload,
  pending chat return/reload, real server feed recovery, Codex review recovery,
  Claude Code review recovery, and Neuroscience field coverage. A separate
  paper-context/History browser regression also passed.
- The ingestion browser scenario made one POST and produced one ingest ledger
  entry. A route test made two concurrent requests and observed exactly one
  analysis call and one generation call, with a recoverable changeset.
- Tests use a disposable vault, delayed local model responses and local engine/
  source fixtures. These are product-flow tests, not live model-quality tests.
  The user's paper was not re-ingested by this work.

Artifacts (local, outside Git):

`/Users/tongshan/.codex/visualizations/2026/09/13/01a098e1-d370-74b1-b71f-99b0627f2b38/background-actions/`

- `ingest-reconnected.png`: ingestion visible after navigation and reload.
- `ingest-completed.png`: saved state and Undo restored after completion/reload.
- `digest-reconnected.png`: completed digest after returning/reloading.

The verified build is served at `http://127.0.0.1:3000` with scheduled jobs off,
as before. Reloading the user's paper confirmed `In your knowledge base` and
its existing full-text digest. No commit or push was made for this fix.
