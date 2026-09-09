# Literature-review foundation and engine feasibility

Date: 2026-09-07. Status: partial implementation, not deep-review acceptance.

Follow-up: the observed claim failures were corrected and rechecked in the
[claim-grounding correction](2026-09-07-review-grounding-correction.md) session.
The historical pilot findings/costs below are retained; use the follow-up and
shared ledger for current status and remaining allowance.

## Delivered foundation

- One Sparky workspace for quick paper search and saved-research discussion.
  `/papers` compatibility and paper-resolution links remain supported.
- Server-owned History stores questions before work, complete paper snapshots,
  source provenance/warnings, replies and failures. Viewing History never runs
  a search or model call. Follow-ups can use the saved search abstracts.
- Legacy text sessions remain readable. Project identity cannot be changed on
  a saved conversation; a missing project does not widen to global scope.
- Duplicate operation IDs return the persisted answer; interrupted operations
  do not silently rerun. This uses the existing single-process conversation
  queue, not the cross-process coordinator planned for deep-review jobs.
- Fixed-height workspace with an internal transcript scroller, source settings
  in place, browser-tab draft/mode/source-restriction retention, and a single sidebar entry. `/papers`
  no longer claims proactive events whose popup would be hidden in chat.

This does **not** deliver a production deep-review flow: approval, durable jobs,
shared per-run/daily reservations, full-text/PDF acquisition, report editing,
versioning/export and KB reuse remain open. Gap retrieval, evidence tables and
model-assisted claim auditing now exist only in the unwired evaluation trial.

## Upstream evaluation provenance

| Candidate | Pinned revision | Evaluation performed |
| --- | --- | --- |
| [Ai2 ScholarQA](https://github.com/allenai/ai2-scholarqa-lib) | `a96232870bdb0bd763f0131320e8377c6deb575e` | Executed actual quote selection, clustering and iterative synthesis with deterministic injected completions; tested an attributed TypeScript adaptation with the configured live model and public abstracts. Pilot quality has not passed acceptance. |
| [OpenScholar](https://github.com/AkariAsai/OpenScholar) | `0e9b8fb912273d3dae39e593da86e4f6d3bf8de1` | Dependency inspection plus actual API-class generation → feedback → revision execution with injected fixture completions. No full-package runtime or live scientific-quality comparison. |

The clones used by the probe are disposable under
`/tmp/scispark-engine-evaluation-AarVqs/`. No Python package, vLLM service,
embedding model or hosted paper index was installed into SciSpark. The product
still has no Python runtime requirement.

ScholarQA's core sequence is quote selection → quote clustering → iterative
section synthesis. Its default no-quote/LLM-memory fallback and citation-count
quality assumptions are unsuitable for our agreed evidence boundary. The trial
uses evidence-only prompts, preserves contradictions and null findings, validates
exact contiguous quotations, and rejects negative/out-of-range quote indices.
The probe demonstrated that the upstream upper-bound-only index check can accept
negative indices. Full-package imports bring retrieval/Modal dependencies; the
bounded algorithm can instead be hosted by SciSpark callbacks.

OpenScholar imports spaCy, vLLM and other retrieval/inference dependencies at
module load, including loading an English spaCy model. Its direct model calls
and embedded pricing need adaptation even for its API path. This is a footprint
finding, not proof that OpenScholar cannot work or that ScholarQA is superior.
The isolated upstream API-class probe executes three model-call sites with fake
responses, without installing the package. It also exposes a feedback-parser
edge case: a follow-up Question on a separate line can be lost, while one on
the same line is retained. Its revision-length condition can reject a shorter
revision regardless of quality. These require host adaptation, not blanket
claims that the academic engine is unusable.

`src/lib/review/scholarqa.ts` preserves the upstream algorithm, with attribution
and Apache-2.0 license in `third_party/scholarqa/`. Every completion is injected;
the component cannot retrieve private files, call a provider or persist artifacts
by itself. Serializable stage outputs and section yields support a future host
checkpoint layer. It is not imported by any production review route.

Structural tests cover exact quotes, omitted/invalid evidence indices, unknown
citations, citations to evidence not supplied to a section, empty-evidence
fallback refusal, and host-cached step replay. These are attribution checks.
`semanticSupport: "not-verified"` is deliberate: a real paper ID does not prove
that the attached claim follows from it. Neither candidate is selected yet.

Reproduce the zero-network upstream probe:

```sh
python3 scripts/probe-review-engines.py \
  --scholarqa /path/to/pinned/ai2-scholarqa-lib \
  --openscholar /path/to/pinned/OpenScholar
npm test -- src/lib/review/__tests__/scholarqa.test.ts
```

## Frozen live-evaluation questions and rubric

Freeze these before paid comparisons. Use identical retrieved evidence snapshots,
scope, selected model, context control and allowance accounting for candidates
that pass the runtime gate; never compare a fully adapted engine with another
engine's unmodified unsafe defaults without disclosing that distinction.

1. Adult EEG: how do envelope reconstruction and temporal response functions
   differ for studying speech perception in noise, and what remains uncertain?
2. Methods comparison: what evidence supports linear versus deep-learning
   auditory-attention decoding across participants, with attention to leakage
   and evaluation design?
3. Population boundary: which findings about neural speech tracking in adults
   have actually been demonstrated in children, and which are extrapolations?
4. Unrelated-field control: how do retrieval-augmented approaches reduce factual
   errors in question answering, and what failures remain under distribution shift?

Score each dimension 0–2: 0 = missing/incorrect, 1 = partial, 2 = supported and
appropriately qualified. Dimensions: relevant evidence coverage; sampled claim
support; accurate cross-study comparison; handling of contradictions; disclosure
of access/missingness; faithfulness to explicit scope; separation of personal
relevance from scientific conclusions. Inspect at least five material claims and
all study-table rows in each completed trial against their stored passages.
Use both relevant and deliberately unhelpful profile context for one question.
Record latency, input/output/reasoning usage, retries and cumulative priced cost.

Provisional quality gate: no fabricated references/quotations or unsupported
numeric findings, no privacy/source/budget bypass, score ≥12/14 with no zero,
and a demonstrated gap-driven second retrieval when the initial evidence is
insufficient. A short fixture pass cannot satisfy this gate. If the $2 total
allowance cannot cover the trial, retain partial findings and ask before any
extension; do not lower the quality gate or silently switch models.

## Paid-test boundary

The user approved their configured provider in a disposable vault, **$2 total
estimated allowance across attempts**, not $2 per question or per candidate.
Paid tests began after the user supplied endpoint pricing. The shared ledger is
`/tmp/scispark-review-live-GWqrkU/.scispark/review-evaluation/allowance.json`.
It includes all successful, schema-invalid and length-truncated attempts. The
latest pilot results and exact cumulative spend are recorded below; earlier
$0 snapshots no longer describe the session.

The redacted active settings show `google/gemini-3.8-flash` through the
OpenAI-compatible GMI endpoint. On September 7 the user supplied its rates:
$0.75 per million input tokens, $3.75 per million output tokens, and $0.075 per
million cache-read tokens. This is user-provided endpoint-specific pricing, not
a tariff independently verified against Google's direct API. The legacy global
model table is not changed to apply GMI rates to other endpoints.

`scoped-pricing.ts` counts cache reads as a subset of input and reasoning as a
subset of output. Missing/inconsistent usage remains unknown. Reservations use
full input price, never assumed cache hits. The OpenAI-compatible adapter retains
reported cache/reasoning metadata for both streaming and ordinary responses.

The opt-in `live-evaluation.test.ts` uses an explicitly named disposable directory,
an exclusive process lock, immutable stage signatures, and a persistent **single
$2 cumulative ledger** across questions/controls/attempts. Every actual HTTP
attempt is reserved before sending; schema failures are still charged; uncertain
billing holds its reservation and blocks automatic replay. This evaluation guard
is **not yet** the planned production daily-budget/job coordinator. Credentials
are reused read-only in memory, not copied into reports or the evaluation vault.

Live model structured-output compatibility is demonstrated, but scientific
synthesis quality, broader passage access and the engine-selection gate remain
open. Neither a valid JSON response nor matching quotations proves entailment.

## Live pilot: adult EEG question

The trial reused the configured model with thinking enabled; no fallback model
or reasoning-off substitution was used. All artifacts are disposable and public
research evidence or synthetic profile context. Real credentials are held in
memory only. The human vault/server on port 3113 were not changed.

Initial fixed queries were `EEG speech envelope reconstruction noise` and
`temporal response function speech perception noise`, each sent to arXiv,
OpenAlex, Semantic Scholar and PubMed with four results requested. All four
adapters responded successfully in this trial; Semantic Scholar was paced.
This does not establish that sources can never rate-limit or fail. Snapshots
are reused on resume, not fetched again for each synthesis attempt.

Cross-index deduplication initially missed the same DECAF preprint under its
arXiv ID versus `10.48550/arxiv...` DOI. The fixed identity merge handles these
aliases and shared-ID bridges without merging different identified papers
merely because titles resemble one another. `evidence-v2.json` records the ten
interleaved initial abstracts used by the paid trial; this is a bounded pilot,
not an exhaustive literature search.

Observed iterations (all retained under `trial/q0/`):

1. Original quote prompt selected no evidence. Two focused native-JSON/plain-JSON
   probes both returned a relevant exact quote after simplifying the task.
   This isolated a prompting issue; it did not justify disabling thinking or
   claiming the provider cannot return nullable structured objects.
2. Partial-evidence selection yielded P2, P3 and P9. The first synthesis falsely
   called some results unreported because the selected quote omitted results
   elsewhere in the abstract. Synthesis now receives the full available source
   text alongside the relevance quote. Earlier deficient outputs are preserved.
3. Coverage analysis identified comparison and diagnostic-validity gaps. A second
   retrieval sent two targeted queries: PubMed returned zero results and Semantic
   Scholar returned five. Four new nonduplicate abstracts were saved; two were
   selected, including evidence of absent individual behavioral correlation and
   an age-group comparison. The expanded review therefore uses five studies.
4. Five passage-backed comparison rows were extracted, with unreported fields
   explicitly null and access marked abstract-only. All rows were inspected
   against the saved abstracts. Population/method/result attribution generally
   matches; source text for P3 has missing inline mathematical symbols, so claims
   depending on the lost metric need original-text recovery, not inference.
5. An all-paragraph audit exhausted 8,000 completion tokens, mostly reasoning.
   A two-paragraph revision completed one batch but the next exhausted 6,000;
   the first batch also joined noncontiguous source passages with ellipses.
   The audit now checks one paragraph at a time with a larger reasoning/output
   ceiling and validates exact passages before making the next paid call.
   Failed outputs remain recorded and are not reused as verified evidence.
   The final paragraph-level audit completed all seven checks and flagged six
   paragraphs as partially supported. Its exact-quote checks passed. The one
   paragraph the model approved still overstates diagnostic certainty in the
   manual check; audit approval is therefore not treated as scientific truth.

Final pilot accounting, verified from the shared ledger after all calls settled:
**$0.33594525 spent of $2**, **$1.66405475 remaining**, **$0 held**. There were 53
HTTP completion attempts across all retained iterations/probes, totaling 64,467
input and 76,692 output tokens. The provider reported 65,262 reasoning tokens
(already included in output) and zero cache-read tokens. The cache discount is
covered by deterministic tests, not claimed as an observed saving in this pilot.
The final resume reused completed synthesis/table steps and spent only on the
new paragraph audit. No paid process is left running.

### Manual evidence checks and unresolved quality issues

Checked all five table rows and these material report claims against source
snapshots (internal P IDs refer to the fixture, not a user-facing bibliography):

| Claim | Evidence check |
| --- | --- |
| SRTneuro within 3 dB | P2 explicitly reports this in 20 young normal-hearing participants. Do not generalize to all listeners. |
| Combined 3–5 dB range in paragraph 2 | The overall evidence contains both numbers, but that paragraph cites P3/P9/P11 and omits P2, which supplies 3 dB. This is a claim-level citation attribution failure. |
| SRTneuro within 5 dB but no significant individual behavioral correlation | P11 reports both in 21 young normal-hearing adults; the draft sometimes drops that study/sample boundary. |
| MEG reconstruction about 1.5× scalp EEG and 3× ear EEG | P11 supports the numerical comparison in its sample; not a universal instrument-performance claim. |
| Older participants had **significantly** higher reconstruction | P12 says higher, but the available abstract does not establish statistical significance. The draft added an unsupported qualifier. |
| Shared neural mechanisms established by concurrent measures | P2 says suggest/may be linked; stronger mechanism claims overstate the abstract. |
| Envelope tracking is insufficient as an independent diagnostic tool | P11 says may be insufficient; the draft's definitive clinical generalization is too strong. |
| DECAF improved on static EEG-only baselines | P9 reports improvement on its benchmark, but participant age is not supplied. Treat it as method context, not adult-specific validation. |

The report also repeats material across sections, lacks a prominent abstract-only
coverage disclosure and lacks the required separate personal-relevance section.
The current evidence does not adequately establish the formal forward/backward
model distinction. Some source abstracts are malformed after ingestion. These
are quality gaps, not reasons to lower the frozen acceptance threshold.

No final 12/14 acceptance score is assigned: remaining frozen questions,
identical-evidence profile control and live candidate comparison are unfinished.
The human checks above already show that the current draft
cannot be presented as a verified literature review. A single-model audit is
not independent scientific verification even when its JSON and quotes validate.

## Local verification: delivered workspace foundation

- Full Vitest: **2,420 passed, 15 skipped**; 249 files passed, one skipped.
- TypeScript: passed. ESLint: zero errors; existing `ConnectAiCard.tsx:172`
  `applyPreset` hook-dependency warning remains unrelated.
- Isolated production build `.next-literature-workspace`, build ID
  `7Ac9c4OIY7l3027pRpP2V`: passed. This is not the artifact serving port 3113.
- All **25 production/disposable-vault browser tests passed** on that artifact
  (1.6 minutes), including scoped chat/History/export/Undo, search draft/source
  restrictions, streaming, long conversations, onboarding and existing regressions.
  Final 390px light/dark screenshots show the latest messages and visible composer.
- In-app browser on an isolated, key-free preview at port 3124: inspected saved
  result rendering, source Settings remaining in place, draft preservation after
  Home → Sparky and History reopening, and light/dark rendering. Data is explicitly
  fictional. No real scholarly search or paid generation was represented by it.
- Automated browser cases separately exercise model streaming using the local
  mock provider, and long transcripts at desktop and actual 390px phone width.
  Saved-result UI tests seed snapshots; unit/API tests exercise search orchestration.
  Neither is a real-provider deep-review walkthrough.

Foundation commands: `npm test`; `npx tsc --noEmit`; `npm run lint`;
`SCISPARK_LIVE_GATE_DIST_DIR=.next-literature-workspace npm run build`;
`SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-literature-workspace npm run e2e`;
`git diff --check`. All passed, with the existing lint warning noted above.

Visual inspection found a scroll-effect ordering bug: the effect ran while the
loading placeholder was mounted, so reopened long chats stayed at the oldest
message. It now waits for the transcript, and browser tests assert distance from
the latest message as well as internal scrolling and visible composer bounds.
Phone headers stack their actions rather than squeezing the title into a narrow
column. Returning to a draft retains Find papers/Discuss research, Read Sources
Only, and temporary source restrictions; newly disabled sources are removed, not
silently replaced with a broader search scope.

The offline preview tab and its port-3124 server were closed after inspection.
The existing human server/vault on port 3113 was not restarted or modified. No
commit, push or deployment was performed. Existing unrelated worktree changes
were preserved. Continue Phase 0's quality gate using the shared remaining allowance, then the
approved brief/context/jobs/budget/report phases in the implementation plan.

## September 7 follow-up: pricing and unwired engine trial

- Final offline suite: **2,437 passed, 16 skipped**, 253 files passed and two
  skipped. TypeScript passed; ESLint has zero errors and the same pre-existing
  `ConnectAiCard.tsx:172` dependency warning. `git diff --check` passed.
- Endpoint-scoped pricing tests cover the user-supplied input/output/cache rates,
  cache-as-input-subset accounting, no double charging for reasoning, conservative
  reservations and unknown/malformed usage. No global provider price is assumed.
- The adapter preserves cache/reasoning usage metadata; structured retries retain
  their aggregated usage. The evaluation ledger reserves before every HTTP
  attempt and persists uncertain billing instead of reporting zero cost.
- Evidence tests cover arXiv DOI deduplication, exact table quotations, disabled
  source refusal, per-paragraph audit identity and immediate stop on fabricated
  audit passages. TypeScript and `git diff --check` passed after these changes.
- The live harness completed its pipeline pilot with five table rows and seven
  support checks. Its passing execution test is **not** a passed scientific
  acceptance test: six paragraphs were flagged, and the manual checks found
  problems even in the seventh. No candidate is selected for production yet.
- No new browser/build acceptance is claimed for this follow-up; it changed
  provider accounting and unwired evaluation code, not rendered components.
  Foundation build/browser results above refer to the earlier artifact.
