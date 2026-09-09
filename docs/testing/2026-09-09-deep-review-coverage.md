# General review coverage and source recovery

The September 8 production retry passed claim-support checks but did not adequately
answer the methods comparison. The shared workflow lacked an explicit contract for
what the question required, and its full-text acquisition rejected publisher hosts
locally without trying an exact-identity repository alternative. Rechecking claims
could therefore improve grounding while leaving the substantive answer incomplete.

## Shared changes

- Define one to six question-specific requirements before planning searches.
  Rank reading candidates against the question and requirements; direct the existing
  bounded gap-search round toward missing requirements. Apply the same requirements
  to quote selection, outlining and drafting across topics.
- Assess evidence coverage before drafting and actual answer coverage after claim
  checks. Require every requirement exactly once, exact source quotes, and an exact
  passage in the findings for an addressed final verdict. These checks validate
  provenance and structure; semantic adequacy is still an automated assessment.
- Persist coverage independently of grounding. A source-checked report with missing
  coverage remains partial, displays its gaps, and cannot spend money on a claim-only
  retry. A new review with additional evidence or revised scope is required.
- Invalidate coverage metadata and the marked generated coverage section on edits
  and revisions. Older report versions remain unchanged; legacy versions display
  coverage as not assessed.
- Try bounded public PDFs and exact-DOI Europe PMC open-access XML after permitted
  direct full-text candidates. Check article identity/body, cap network bytes at
  5 MB, retain extraction/text limits, and disclose truncated readings. Distinguish
  local relay policy blocks from publisher access denials. Relay upstream requests
  have a 20-second timeout and only narrowly specified Europe PMC API paths are added.
- Include the isolated PDF worker in production review-route tracing.

Europe PMC documents the search and full-text XML endpoints in its
[official API documentation](https://europepmc.org/RestfulWebService).

## Validation

- Full Vitest suite: **2,487 passed, 17 skipped**, across 258 passed and 3 skipped
  files. Paid live tests remain gated. Regression fixtures cover unrelated learning
  and battery questions, incomplete comparisons, invalid coverage identities,
  unavailable quotes, gap targeting, blocked claim-only retries, and edited versions.
  Final affected review/relay rerun: 110 passed / 2 gated tests skipped.
- Targeted ESLint, TypeScript and `git diff --check` passed. Production webpack
  build `.next-review-coverage` / `svQ2X8nbSp07jBUknU4DQ` passed.
- Production Chromium review/retry/History/edit/export/knowledge-base/mobile and
  actual server restart-recovery tests passed (2/2). Desktop and mobile screenshots
  were inspected. Browser fixtures replace external
  sources/model responses; they do not establish live scientific quality.
- Public-source-only live probe recovered full text for **two of three** previously
  cited papers: P2 at `PMC6636082` and P3 at `PMC5127806`. Both were read to the
  45,000-character limit with explicit truncation notes. P5 remains abstract-only.
  No model calls were made by this probe.

Source probe records and its archived temporary test are under
`/tmp/scispark-review-live-GWqrkU/source-recovery-2026-09-09/`. Test logs are
`/tmp/scispark-coverage-final-tests.log` and `/tmp/scispark-coverage-build.log`.

## Acceptance boundary

No new paid synthesis was run for this change. The existing saved live report and
canonical allowance ledger were preserved: **$1.396932 accounted, $0 held,
$0.603068 remaining**. Live end-to-end answer quality with the new requirements and
recovered text remains unverified. A future paid acceptance run must retain that
cumulative allowance and exercise the shared production workflow. No commit/push
or human-vault migration was performed.

## Scoped commit verification

After the user authorized commit and push, the review feature and its required
chat, source-selection, acquisition, billing and persistence dependencies were
assembled over Git HEAD in an isolated snapshot. Unrelated onboarding, feed-field,
trending, companion and broader cost-display changes remain in the working tree;
shared files were staged only for the required portions.

The isolated candidate passed 2,356 Vitest tests (17 gated skips), TypeScript,
targeted ESLint and production webpack build `0vjKrsq-M-lJDP3QNNjvR`. Production
Chromium review, restart, saved-search/settings, long-conversation and streaming
checks passed (six tests). No paid model calls were made. These results supersede
whole-working-tree checks as the validation evidence for the scoped commit, while
live scientific-quality acceptance remains open.
