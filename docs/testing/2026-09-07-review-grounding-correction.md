# Literature-review claim correction

Date: 2026-09-07. Scope: fix the unsupported/overstated claims found in the
academic-engine pilot. This is not delivery of the entire deep-review product.

## Changes

- `src/lib/review/grounding.ts` adds a host-injected correction/recheck stage
  around the reused ScholarQA synthesis. Every paragraph is rewritten as
  individual claim → paper → exact-passage mappings, including paragraphs a
  previous coarse audit accepted.
- Conservative checks reject missing/edited/noncontiguous quotations, numbers
  absent from the claim's own supporting passages, added significance without
  textual support, and loss of uncertainty when all supporting passages are
  tentative. These checks are not a general semantic-entailment algorithm.
- A separate model call checks each revised claim's relation, direction,
  population, numerical context and certainty, plus lost supported findings.
  No private preference is treated as scientific evidence.
- At most two correction attempts per paragraph. Actual remaining claim errors
  keep `needs-review` status; they cannot render via the checked-report path.
  Empty output, missing/duplicate audit identities, source changes and budget
  errors cannot become passes. Earlier drafts and attempts remain retained.
- SHA-256 audit signatures bind claims to the full supplied evidence snapshot.
  Claim or source edits invalidate earlier checks. This does not implement the
  planned production report-version/job coordinator.
- Open research questions are separate from failed claims. They appear in the
  report as questions, not invented findings. Their existence is not a reason
  to keep rewriting a scientifically cautious paragraph.
- The checked Markdown draft shows access coverage, attaches citations to each
  claim and includes source identities. It explicitly distinguishes automated
  checks from independent scientific validation.
- Future synthesis prompts also preserve uncertainty/sample boundaries and
  require every source contributing to a numerical comparison.
- The PubMed adapter now preserves mixed-content title/abstract reading order
  instead of losing inline symbols and formatting children. Tests cover italic
  `r`/`z`, negation, qualifiers, section labels and simple scripts/fractions.
  This is not a complete mathematical typesetting engine. Existing cached
  abstracts are not silently rewritten.

## Live correction and replay

The correction reused the original five abstract-only evidence snapshots and
seven-paragraph draft from `trial/q0/synthesize-v2/` in the **same** disposable
vault `/tmp/scispark-review-live-GWqrkU`. It did not change the source sample,
retrieve extra papers, reset the paid allowance, replace the model, disable
thinking, or write to the human vault. Provider credentials remained in memory.

The initial live correction run exposed a completion-state bug: it treated
legitimate open research questions as failed claims, causing unnecessary second
rounds. That run and its charges are retained. This was corrected by separating
disclosed evidence gaps from failed claims; the claim-support checks were not
relaxed. In particular, omitted supported findings and unsupported claims still
block the checked-report path.

After that fix, **cache-only replay passed**. It revalidated the saved first
supported revision of each paragraph; two paragraphs required a second rewrite
for a number-format mismatch or dropped uncertainty. The final result has:

- **7 checked paragraphs, 35 individually cited claims, 0 outstanding claim
  issues** under these automated checks.
- Five abstract-only sources, no full-text/PDF access claimed.
- Open research questions disclosed separately.
- No new provider calls during replay; the ledger total was unchanged.

The final artifacts are under `trial/q0/ground-v2/`:

- `grounded-review-v2.json`: claim evidence, audits, signatures and status.
- `report-grounded-v2.md`: reconstructed checked draft.
- `corrections-v2/`: per-paragraph/per-attempt checkpoints.
- Earlier raw model outputs and `corrections/` remain available for inspection.

### Manual before/after checks

The revised claims and their saved passages were inspected, including all three
concrete examples raised with the user:

| Original failure | Corrected output |
| --- | --- |
| P12's higher accuracy became significantly higher | The age-comparison statements now say higher, without adding statistical significance. |
| P11's may be insufficient became is insufficient | The diagnostic statement retains may be insufficient and the sample-specific null association remains present. |
| A 3–5 dB paragraph omitted the source for 3 dB | Separate threshold claims attach P2 to 3 dB and P11 to 5 dB, retaining the study/sample distinctions. |
| Tentative shared-process interpretation became a definite mechanism | The revised statement says suggests/may be linked rather than establishing a mechanism. |
| Formal forward/backward definitions lacked supplied support | Those definitions are not asserted as established by these abstracts; unresolved methodological questions are disclosed. |

Remaining report limitations: substantial repetition and some awkward numerical
capitalization remain; the sample is small and abstract-only; formal method
definitions need additional sources. The single-model auditor can still make
mistakes. The corrected pilot is not a passed full scientific-acceptance gate,
a systematic review, or a guarantee that future generations have no errors.
The remaining frozen questions, profile-control comparison and engine-selection
work are still open, as are production approval/jobs/report UI integration.

## Cost

Configured model: `google/gemini-3.8-flash` at the approved GMI endpoint, thinking
enabled. User-supplied USD/M rates: input 0.75, output 3.75, cache reads 0.075.

Final shared ledger: **$0.77906775 spent of the approved $2**, **$1.22093225
remaining**, **no held reservations**; 79 total HTTP completion attempts across
this and all earlier iterations. This turn added 26 calls and $0.44312250.
No paid process remains running. Cache-only replay added zero calls or cost.

## Verification

- Full offline Vitest suite: **2,446 passed, 16 skipped**.
- Focused review/PubMed suite: **43 passed, 1 skipped** (paid test gated off).
- TypeScript passed. ESLint: zero errors, the existing
  `ConnectAiCard.tsx:172` dependency warning only. `git diff --check` passed.
- An isolated production build using `.next-review-grounding` and a disposable
  vault remained at the compilation stage without further output and was
  interrupted. It produced no `BUILD_ID`; production-build verification for
  this follow-up is incomplete. No compiler error or root cause was established.
- The paid correction outputs plus cache-only integration replay were exercised
  against the real configured provider and saved public evidence. No browser
  or full-product deep-review acceptance is claimed for this library-only work.
- Active server/vault on port 3113 untouched. No commit or push.
