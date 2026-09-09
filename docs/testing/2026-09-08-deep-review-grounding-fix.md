# Grounding failure correction — September 8, 2026

## Diagnosed failures

Inspection of the immutable checked-claims artifact found exactly two failed paragraphs. One introduced an adult population qualifier absent from the cited abstract. The other was blocked by deterministic uncertainty lint: its quotation asserted a decoding result and separately speculated about future applications, while the claim only described the result.

## Changes

- Rewriting now explicitly distinguishes requested population from reported population, and directs retries to repair prior claims without introducing new qualifiers.
- The uncertainty regex remains a warning sent to the independent semantic audit. That audit must affirm support at the clause level. Exact quotation, numerical and significance failures still block the audit; missing/rejected/stale audits still block checked rendering. No unsupported claim is automatically accepted.
- Partial-report citation IDs are deduplicated. The aggregate grounding checkpoint version is incremented so revised checks do not reuse a stale aggregate artifact.

## Verification

- Review suite: 49 passed, 2 explicitly gated live tests skipped. Focused regressions cover the observed-result/speculative-application distinction, actual dropped uncertainty, and unsupported population correction, alongside existing quote/number/significance/omission/stale-audit rejection cases.
- TypeScript passed; targeted ESLint passed.
- Paid repair gate: passed against the unchanged GMI Gemini 3.8 Flash endpoint. Only the two failed paragraphs were rewritten and audited using the same saved public evidence. Four new calls cost $0.04329675. The other four paragraph audits remain unchanged; combined 27 claims passed checked-report rendering with intact evidence signatures.
- Cumulative ledger: 116 attempts, $1.219032 accounted (including the historical $0.01937475 conservative charge), $0 held, $0.780968 remaining of the original $2 allowance.
- Original partial report and coordinator state are preserved. The repaired artifact is a separate checked draft, not a fresh full-pipeline/coordinator acceptance run. No new retrieval/browser verification was performed.

Repaired report: `/tmp/scispark-review-live-GWqrkU/integration-v1/repair-2026-09-08/checked-report.md`.
Repaired claims and audit signatures: `grounded-review.json` in the same directory.
Temporary paid harness archived at `/tmp/scispark-review-live-GWqrkU/grounding-repair-2026-09-08.test.ts.txt`; removed from the source test directory.

## Limits

The three cited sources remain abstract-only. The report discloses missing population details and direct comparative evidence. Repetition, broad best-performance wording inherited from previously accepted paragraphs, and incomplete comparative coverage still limit editorial/scientific acceptance. Passing automated grounding is not independent scientific validation. No human-vault changes, commit, push, or further paid run.

## General production recovery (subsequent correction)

The user clarified that recovery must be part of the general process, not a report-specific harness. Shared grounding logic already applied to all reviews, but the saved-partial recovery path was missing. It is now wired through the ordinary ReviewBlock → review API → coordinator → pipeline flow:

- Partial reviews expose **Retry source checks**, with a disclosure of saved-research reuse, remaining-allowance charging, version preservation and possible continued failure.
- Explicit partial retries increment a persisted grounding attempt. Only grounding model calls use the new attempt identity; planning, retrieval, extraction, tables and synthesis reuse valid checkpoints. Paused/interrupted resumes keep their current attempt, so an interruption does not silently discard paid work.
- Existing revision, active-job, model/context authorization, uncertain-charge and cumulative review/daily-budget checks remain in force. Reopening or reading a partial result starts no work.
- Completion appends a new pipeline version with the prior version as parent. History links point to the latest pipeline version, without overwriting the original partial report or duplicating completion on snapshot reads.
- Unrelated learning-intervention and battery-charging fixtures both exercise actual rejected audits → partial → explicit retry → completed, asserting research reuse, fresh source checks, immutable prior versions, latest-version History, stale-action rejection and no paid work on read.
- Full suite: **2,473 passed / 17 gated skipped**, 256 passed / 3 skipped files. TypeScript and targeted ESLint passed.
- Chromium: real HTTP/coordinator retry control passed in a disposable fixture vault, alongside existing editing/export/KB flow. The mobile retry screenshot was inspected at 390px; no horizontal overflow. The browser test seeds a partial manifest, while unit integration tests produce actual partial outcomes from rejected audits.

No new paid calls, production build, commit, push, or human-vault migration. Existing saved partial reports use the schema's default grounding attempt and can be retried through the normal UI after loading this code. This retry reruns all grounding paragraphs; it does not promise broader evidence coverage or guarantee a checked result.
