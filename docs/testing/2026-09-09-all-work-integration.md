# September 9 all-work integration

The user authorized committing and pushing all remaining work and merging all
outstanding branches into main. Commit `2e9a10e` contains the 182 remaining local
files: onboarding and profile flows, shared research-field preferences, trending
navigation, paper feedback, companion behavior, cost reporting, fixtures and docs.

The integration branch joins that commit, main at `6da8c4b`, and all 14 commits
from `loop/loop-engineering-hardening` through `08a8104`. The older branch adds
orchestrator run records, acceptance/spend reporting, trending failure backoff,
post-ingest deterministic lint, projected budget checks and a scheduler.

## Merge reconciliation

- Keep current Trending board retrieval, field/subfield settings and source APIs.
- Preserve persisted-ID undo validation, and record reverts centrally after a
  successful undo. Client-provided changeset contents remain rejected.
- Preserve nullable unknown costs in usage, run records and acceptance aggregates.
  Round projected input token counts to integers before pricing validation.
- Keep concurrent Feed and consolidation requests joined to their existing shared
  runs; wrap the shared execution in the new run ledger.
- Extract pure slug sanitization so reader code cannot import server-only lint
  dependencies through ingest.
- Recover review state at startup without paid replay. The scheduler is opt-in:
  only `SCISPARK_SCHEDULER=on` starts timers. Unset or `off` leaves it disabled.
  Enabled schedules retain their cadence, backoff, overlap and budget checks.

## Validation

- Full Vitest suite after final runtime edits: **2,566 passed, 17 gated skips**
  across 263 passing and three skipped files.
- Full ESLint: no errors; one pre-existing `ConnectAiCard.tsx` hook dependency
  warning. Targeted lint after the final scheduler/formatting edits passed.
- Production webpack build and TypeScript passed; final build ID
  `GfUvXy6XmpiRD4EgEmDRh` in `.next-merge-final`.
- Full production Chromium suite: **27 passed**, including desktop/phone layouts,
  first-run setup, source settings, profile avatar, feedback/undo, streaming,
  review approval/edit/export and restart recovery. This run used the combined
  build before the final scheduler opt-in change with scheduling explicitly off.
- Final production build, scheduler variable unset: **two Chromium tests passed**
  covering literature-review approval/edit/export and restart recovery. A unit
  regression verifies unset scheduler configuration creates no timers.
- Inspected rendered phone Trending and desktop paper-action screenshots.
- Conflict-marker and whitespace checks passed. Temporary build-directory
  additions to tsconfig were removed; existing user changes were preserved.

Validation used disposable vaults and fixture model responses. No paid live
synthesis was run; prior live scientific-quality acceptance remains open. The
original checkout and human testing vault were preserved during integration.
