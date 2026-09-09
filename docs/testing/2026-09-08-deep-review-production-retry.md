# Production UI live retry — September 8, 2026

## Outcome

**Production retry passed; broad research-quality acceptance remains open.**

The user authorized the saved partial review to be retried through its real production control within the original remaining evaluation allowance. No fixture provider, custom route, or manual status override was used to complete the review.

- Fresh production webpack build `.next-review-production-retry`, ID `EVfGQrrCrSM-3D1BLSZG_`, passed compilation and TypeScript.
- An isolated loopback Next production server served the existing synthetic evaluation vault. An ephemeral settings-read overlay held the unchanged GMI Gemini 3.8 Flash credentials in memory, without copying them into the vault. Its fetch guard allowed only the authorized grounding/personal-interpretation calls to the configured endpoint.
- Chromium loaded `/chat/integrated-adult-eeg` and clicked **Retry source checks**. The ordinary API returned HTTP 200; the coordinator moved partial → running → completed and groundingAttempt became 1.
- Navigating to History did not interrupt the run. Existing search, acquisition, table, outline and synthesis checkpoints were reused. Fifteen new model calls ran: fourteen grounding rewrite/audit calls and one separate personal-interpretation call.
- Version 1 (`v_7d02b384-01f2-4385-aff9-a724247b820d`, needs-review) is unchanged. Version 2 (`v_9edad351-3ffc-4481-9bdd-aeb53a75eb9e`, checked-draft) names version 1 as its parent.
- Browser readback verified latest-version selection, the original partial report selectable, latest-version History linkage, and no new usage on reopening. Desktop/mobile screenshots were captured; the 390px screenshot was inspected and horizontal overflow was absent.

## Budget provenance

The canonical ledger is `/tmp/scispark-review-live-GWqrkU/.scispark/review-evaluation/allowance.json`.

The original remaining $0.780968 was reserved before clicking. The production review's cumulative cap was tightened to $1.17763849 (its existing $0.3966705 plus the remaining allowance, less a rounding margin). Normal per-call reservations and metering remained active. The new approval captured this lower cap.

Canonical entry `attempt-117` is explicitly an **aggregate workflow reservation**, covering the fifteen individually recorded HTTP attempts in `integration-v1/.scispark/usage/review-attempts.json`; it must not be counted as just one model request. The before snapshots, individual new attempts and reconciliation are retained in `production-ui-2026-09-08`.

- Retry cost: **$0.177900** (59,770 input / 35,486 output tokens, including 29,017 reasoning tokens already within output; no cache reads).
- Cumulative accounted spend: **$1.396932**, including the historical $0.01937475 conservative charge, not provider-confirmed usage.
- Remaining original allowance: **$0.603068**. Held reservations: **$0**.
- Canonical ledger reconciled exactly to summed production usage. Evaluation lock and active-job record cleared; no additional paid replay.

## Research-quality inspection

The checked status establishes automated grounding, not a complete answer. Three cited abstracts support general methodological descriptions and specific study findings. The report still:

- Leaves the central forward-encoding versus backward-reconstruction assumptions and interpretation comparison in its open questions.
- Repeats several findings across sections.
- Cannot establish adult sample details, parameter choices or head-to-head numerical performance from the accessible text.
- Uses broad best-performance wording for one study that merits tighter attribution.

Accordingly this is a technical acceptance pass, not broad scientific acceptance or a release-ready research result. No commit/push was made: the proposed acceptance condition included checking whether the report answers the question, and that condition remains unmet. The workspace also contains substantial pre-existing uncommitted work, which was preserved.

Report: `docs/testing/2026-09-08-deep-review-production-report.md`.
Detailed screenshots, original report, accounting and browser readback: `/tmp/scispark-review-live-GWqrkU/production-ui-2026-09-08`.
The ephemeral server/browser scripts were archived there and removed from `scripts/`; only this build's generated tsconfig include entries were removed. Human vault and port 3113 were untouched.
