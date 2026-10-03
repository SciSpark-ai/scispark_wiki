# Codex model selection and review recovery — 2026-09-29

The follow-up screenshot showed three failed planning attempts for the same
review. All used `gpt-6-astra`. The first two attempts were acknowledged and the
third was still uncertain; no sources had been acquired. Inspection did not
change the user's settings, review or attempt ledger.

## Findings

- At the initial inspection, the installed Codex CLI was 0.146.0. Its own read-only `app-server` `model/list`
  response lists `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`,
  `gpt-reserve` and `codex-auto-review`. It does not list `gpt-6-astra`.
- The previous picker used suggestions from the desktop application's newer
  shared model cache (client 0.155.0). This was not the installed CLI's catalog.
  The catalog mismatch is verified; it does not establish the exact cause of
  the historical failures, whose raw diagnostics were not retained.
- With network access explicitly denied, the installed CLI emitted top-level
  `error` events for reconnection notices. The adapter incorrectly treated such
  a notice as permanently fatal even if the same CLI request later completed.
- Updating a failed review's brief preserves uncertain attempts, but approval
  previously had no acknowledgement path. The displayed resume action could
  not proceed from the resulting `awaiting-approval` state.

## Changes

- Read the installed CLI's catalog using only `initialize` and `model/list`.
  Bound pagination, output and runtime; cache successful reads for 60 seconds.
  Do not start a thread, inference turn or connection test to populate choices.
- Show the returned models in Settings and preserve unavailable saved IDs
  visibly. Block saving/testing unavailable selections. Never silently change
  the user's chosen model.
- Check model availability before reserving a review attempt or dispatching
  inference. An unavailable selection adds zero attempts and no uncertain usage.
- Check inactive review snapshots against the current catalog without rewriting
  their saved failure. Show Choose model, disable retry while unavailable and
  explain the Edit brief → Update brief recovery path.
- Permit explicit acknowledgement when approving an amended brief. Retain the
  original attempt history. No automatic retry or acknowledgement was added.
- Treat recognized reconnection notices as nonterminal. A failed turn, missing
  completion or other actual error still fails. This does not add retries.

## Verification

- TypeScript passes.
- ESLint: zero errors; the existing ConnectAiCard exhaustive-deps warning.
- Vitest: 2,637 passed / 17 gated skips. Regression tests cover reconnection
  followed by success, unavailable models with zero attempts, read-only warning
  snapshots, explicit amended approval and the recovery controls.
- Production Turbopack build passes; 63 pages generated.
- The installed-engine read-only check confirms Codex 0.146.0 signed in and
  captures the catalog above. Claude Code 2.1.282 is signed out.
- Six Chromium tests pass. They exercise local-model selection for both fixture engines, feed
  navigation, the complete review workflow and both engines' review navigation
  and failure recovery. Codex recovery reproduces an unavailable saved model,
  opens Settings from the warning, saves an available model, updates the brief,
  explicitly acknowledges the old attempt and reaches a completed draft.

Browser checks use disposable vaults, deterministic CLI fixtures and fictional
preseeded source evidence. They do not validate live inference or research quality.
No additional inference was run for this follow-up. The earlier authorized
diagnostic was inconclusive because its output was not captured; the requested
additional diagnostic has not been authorized. The actual review remains paused.
The corrected production preview runs at `http://127.0.0.1:3000` with scheduling
disabled. The actual Chrome review displays the unavailable-model warning and
disabled retry. Its manifest and attempt ledger match their pre-check SHA-256
hashes byte-for-byte.

Commands:

```sh
npx tsc --noEmit
npm run lint
npx vitest run
SCISPARK_SCHEDULER=off SCISPARK_LIVE_GATE_DIST_DIR=.next-model-catalog NEXT_TELEMETRY_DISABLED=1 npm run build
SCISPARK_SCHEDULER=off SCISPARK_CODEX_PATH="$PWD/e2e/fixtures/engines/codex.mjs" SCISPARK_CLAUDE_PATH="$PWD/e2e/fixtures/engines/claude.mjs" SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-model-catalog npm run e2e -- e2e/local-engines.spec.ts e2e/review-background.spec.ts e2e/literature-review.spec.ts e2e/feed-background.spec.ts
```

No commit, push or merge was performed.

During the later feed follow-up, the installed CLI changed to 0.159.0. Its native
catalog now lists the 6-series models. See the feed-navigation report for the
compatibility update; the earlier catalog result above is a historical snapshot.
