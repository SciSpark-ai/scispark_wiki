# Review navigation and failure recovery — 2026-09-29

The reported review was saved as `paused` after its first
`answer-requirements-v1` call through Codex with `gpt-6-astra`. It had no acquired
papers and one uncertain engine attempt. Its error came from the engine adapter,
not the coordinator's server-interruption recovery. The original adapter retained
only a generic error, so the underlying CLI failure cannot be determined from
that record. The user's review and usage ledger were inspected without modification.

Review jobs already belong to the local server coordinator. Closing a page stops
UI polling but does not cancel the job. The server must remain running.

## Changes

- Classify recognized model, schema, usage-limit, authentication, service and
  connection failures into fixed, actionable messages. Handle JSON failure events
  and stderr-only failures without exposing raw diagnostics or credentials.
- Unknown failures report that their cause is unknown instead of suggesting an
  account-limit or model problem without evidence.
- Do not send Claude Code's failed result text through the assistant streaming
  callback. Preserve any reported usage.
- Show `Review needs attention` for paused errors and expand uncertain-usage
  recovery by default. Hide the redundant disabled Resume button. Retrying still
  requires the explicit acknowledgement action; no automatic replay was added.
- Clarify that background work depends on the local server staying running.

## Verification

The new browser regression uses a disposable vault, real HTTP routes/coordinator,
CLI subprocess adapters and saved review checkpoints. Deterministic Codex and
Claude fixtures replace subscription inference; public-source searches and
acquisition use preseeded fictional evidence.

Each engine holds its first planning call for 15 seconds. The browser starts the
review, leaves for History, returns and reloads while that call is in progress.
The review finishes with one planning attempt, all calls settled and a rendered
report. Reloading the finished review does not add calls. A separate CLI connection
failure remains paused across reopening/reloading with its attempt record
unchanged and acknowledgement visible.

Commands:

```sh
npx tsc --noEmit
npm run lint
npx vitest run
SCISPARK_SCHEDULER=off SCISPARK_LIVE_GATE_DIST_DIR=.next-review-navigation NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
SCISPARK_SCHEDULER=off SCISPARK_CODEX_PATH="$PWD/e2e/fixtures/engines/codex.mjs" SCISPARK_CLAUDE_PATH="$PWD/e2e/fixtures/engines/claude.mjs" SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-review-navigation npm run e2e -- e2e/review-background.spec.ts e2e/literature-review.spec.ts e2e/feed-background.spec.ts
```

- TypeScript passes.
- ESLint: zero errors, the existing `ConnectAiCard` exhaustive-deps warning.
- Vitest: 2,630 passed / 17 gated skips. New failure-message and recovery-panel
  tests were observed failing before implementation.
- Production webpack build passes, 63 pages generated. The sandboxed Turbopack
  attempt stopped making progress at compilation and was terminated; it is not
  counted as a passing build.
- Four Chromium checks pass: both new local-engine review navigation/recovery
  scenarios, the existing complete review workflow, and feed background refresh.
  Desktop screenshots capture each engine running after reload, its completed
  report, and its visible failure-recovery action.

One user-authorized diagnostic request was attempted using the installed Codex
CLI, `gpt-6-astra`, a small synthetic requirements schema and a 60-second timeout.
The test runner's agent reporter suppressed its captured console output, leaving
the response, usage and success/failure outcome unavailable. This is inconclusive,
not live engine acceptance. A second diagnostic was requested but has not been
authorized or executed. The actual review was not resumed.

No live Claude inference or scientific-quality acceptance is claimed. No commit,
push or merge was performed.
