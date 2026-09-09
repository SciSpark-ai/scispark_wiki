# Deep literature-review integration — September 7, 2026

## Scope and boundaries

The user asked to resume full integration after the saved pilot's grounding
correction. This iteration wires the ScholarQA TypeScript adaptation into the
existing Sparky/History product as an integrated preview. It does not declare
the broader, multi-question scientific-quality gate passed. No human vault,
port-3113 server, profile, or provider settings were modified. The worktree was
already dirty; no commit/push is included.

## Implemented

- Inline question/scope/context/model/pricing/allowance brief and explicit Start.
  Approvals preserve immutable copies of the exact brief. No AI call on preparation.
- Server-owned queued/running/paused/interrupted/cancelled/completed state;
  per-vault disk ownership; hashed immutable checkpoints; one active research job.
  Reopening is read-only with respect to paid work. Startup reconciliation never
  resumes work automatically; uncertain billing requires acknowledgement.
- Conservative per-attempt reservations, including schema retries. Provider-level
  structured fallback is disabled for review calls. Daily checks share an AI-spend
  lock with ordinary skills. Unknown/missing usage and overruns fail closed.
- Existing selected-source adapters/pacing/keys; modest identity-checked Semantic
  Scholar reference following; eligibility/deduplication; coverage-guided second
  search; honest source failures, abstract-only and truncated-text disclosure.
- Article-identity/body verification and bounded user-PDF parsing in a separate
  process. PDF text is input, not executable code or an instruction to the agent.
- Exact quote selection, comparison excerpts, iterative synthesis, per-claim
  corrections and re-audits. Personal interpretation is separate from scientific
  output and exports. A changed personal-context snapshot pauses new work.
- Fixed-height chat/report workspace, mobile panel switching, source inspection,
  immutable report versions, stale-parent edit protection, AI wording revisions,
  pinned-source follow-up chat, Markdown/BibTeX and undoable KB insertion.
- Automatic conversation/brief/report History and one quiet completion event.
  Generic file mutations cannot overwrite job/lock/billing records. Changesets
  reject the whole `.scispark/` prefix, including mixed-case aliases on macOS;
  three new regression cases cover this bypass.

## Verification

- Focused unit/integration gates passed, including contradictory fictional studies,
  personal context excluded from scientific prompts/exports, stale approvals,
  uncertain billing, cancellation, metering repair, pinned follow-up sources and
  three separate processes contending for the same filesystem lock.
- A generated real one-page text PDF was extracted by the real isolated parser.
  Fake/oversize PDFs were rejected. This is parser verification, not a live
  publisher-PDF acceptance claim.
- Initial dev Chromium walkthrough passed: approve, navigate away while the job
  continues, reopen History without calls, inspect/edit/version/export/KB, desktop
  light/dark and mobile overflow/composer checks.
- Production webpack build passed using isolated `.next-deep-review`, build ID
  `iEiLQg7nVFiqovl62O5m-`. TypeScript passed in that build.
- Full Vitest: **2,468 passed / 17 skipped**, **256 passed / 3 skipped files**.
  The live integration test is one of the deliberate environment-gated skips.
- All **six production Chromium tests passed** on the final artifact (19.2 seconds): complete review
  flow; separate-process restart/explicit uncertain-charge acknowledgement;
  recoverable search/Settings; long-chat layouts; reader streaming; saved-chat
  streaming. The restart test kills only its own isolated Next server after a
  fixture response is held, restarts on the same disposable vault, proves reopening
  makes no request, refuses unacknowledged replay and reuses the saved plan.
- Final desktop light/dark and 390px mobile screenshots were inspected. Citations
  open their matching source text rather than a new browser tab. Fixed-height
  panes preserve the composer and avoid document-level horizontal/vertical overflow.
  Screenshots are in the Playwright `test-results/literature-review-*/` output.
- Lint has no errors; the existing `ConnectAiCard` `applyPreset` dependency warning
  remains unrelated. No automatic lint fix was applied to unrelated changes.

## Live evaluation status

The one canonical cumulative $2 allowance remains in
`/tmp/scispark-review-live-GWqrkU/.scispark/review-evaluation/allowance.json`.
Configured Gemini 3.8 Flash uses the user's endpoint-specific $0.75/M input,
$3.75/M output and $0.075/M cache-read prices. Only synthetic research context
was supplied; provider credentials remained in memory and were not copied.

The first full-integration attempt paused before receiving provider usage. The
Node runtime could not resolve the provider host (`ENOTFOUND` in a source-only
diagnostic). The $0.01937475 reservation remains held, not erased or called free:
$0.77906775 known historical spend, $0.01937475 held, $1.20155750 remaining.
No automatic retry or new ledger was created. Approval was requested to count
the held amount conservatively and retry under approved network access. The
complete live pipeline has **not passed** on this iteration.

## Remaining acceptance limits

- Complete the authorized full-pipeline live run and manually inspect sampled
  claims, table rows, identity and coverage. Broad/narrow/unrelated-field and
  unhelpful-profile controls remain part of scientific acceptance.
- Bibliographic coverage is bounded (16 initial + at most six follow-ups by
  default), not PRISMA/exhaustive. Unsupported or empty evidence never proves
  absence of literature. Available HTML/PDF access varies by publisher.
- Edited and AI-reworded versions are explicitly unverified; they are not
  silently relabeled as source-checked. There is no one-click re-audit UI yet.
- PDF OCR, cloud/offline-server execution, multi-host/network-filesystem locking,
  and a submission-ready manuscript editor are not implemented.
- Legacy non-review features retain their own workload/daily-budget semantics;
  the shared lock does not turn every legacy estimate into a strict price cap.

## Reproduction

```sh
npm test
npx tsc --noEmit
npm run lint
SCISPARK_LIVE_GATE_DIST_DIR=.next-deep-review npm run build -- --webpack
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-deep-review npm run e2e -- e2e/literature-review.spec.ts e2e/review-restart.spec.ts e2e/search-settings.spec.ts e2e/streaming.spec.ts
```

Use an explicit disposable `SCISPARK_VAULT` for the build. Browser tests create
their own key-free vault and local fixture provider. The live test is separately
environment-gated; do not run it in CI or retry the held attempt without approval.
