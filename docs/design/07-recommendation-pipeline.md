# Reusable, feedback-aware paper recommendations

Approved direction: 2026-09-04. Implementation and verification status is tracked
in `project_memory.md`; this document is the contract, not a release claim.

## Decision

Separate retrieval, relevance assessment, deterministic scoring, and set-level
diversification. AI may formulate searches and assess semantic fit; it must not
invent publication dates, venue metrics, or the final weighted order.

- Initial weights: relevance 70%, recency 20%, venue standing 10%. These are
  hypotheses for human evaluation, not calibrated probabilities or research-quality
  scores. Unknown venue metrics receive a neutral score with explicit provenance.
- Relevance: anchored 0–4 grades for current-question fit (50%), topic fit (30%),
  and approach fit (20%). Unspecified preferences are omitted and remaining
  weights renormalized. Positive grades require a source-text excerpt; venue and
  citation counts are hidden from the relevance assessor.
- Recency: `100 * 2 ** (-ageDays / 14)`. Exact dates only; no fabricated January 1
  dates from publication years. The main window is 14 days. Bounded older matches
  are labeled separately; unknown dates are labeled, not passed off as fresh.
- Diversity: Focused / Balanced / Exploratory, applied to query planning and
  deterministic redundancy-aware selection. It never rescues an irrelevant paper.
- Venue: accept only versioned, provenance-bearing normalized metrics supplied by
  a trusted data adapter. Do not equate OpenAlex mean citedness with Clarivate JIF,
  or conference ranks with paper quality. Missing coverage must be visible.
- No mandatory `whyThis/whyYou/whyNow` generation. Display factual match evidence,
  dates, score components, source/query provenance, and uncertainty instead.

## Learning boundary

Updated 2026-09-05: thumbs down saves the negative signal immediately, then opens
an optional Sparky follow-up with reason options and a short user-authored note.
It is user-triggered, not a proactive interruption or paid AI call. Save preference
refines the canonical record with an optimistic revision check; Skip retains the
original vote. Different paper questions queue without replacing an unfinished
answer. Late proactive responses cannot replace a feedback question.

Feedback is not dismissal: votes and reasons retain every already-recommended
card in the current cached feed, including after navigation and reload. Only an
explicit Dismiss hides a current card. Undo restores its visibility even when it
restores a preceding negative vote. Future refreshes still use feedback for
candidate selection; recording a preference does not rewrite the current cache.

The pipeline adapts to the individual; it does not rewrite itself or silently
optimize global weights. Explicit feedback is persisted locally, validated, and
undoable through History. Server-owned paper snapshots allow refinement after a
cache refresh and retain the context of the user's reason. The feed user-memory
selector reads these canonical records before planning and each assessment batch.
One example is usable immediately; positive examples can introduce interests
beyond onboarding. Each selection uses topical word overlap plus recency, balances
positive/negative examples, and is capped at 24 memories / 18,000 serialized
characters. This is not embedding retrieval or an evaluated learned ranking model.

Reason-aware memory changes AI search planning and supplies explicit, grounded
ranking effects. Generic dislike reduces close matches, not whole disciplines;
method feedback targets the method; too-old targets freshness.
Already-read and ordinary dismissal suppress only that paper on future refreshes and do not enter
preference inference. Notes cannot alter system rules, tool access or grounding.
These semantics are enforced by the assessment contract and need real-provider
human evaluation; tests prove persistence and context delivery, not semantic accuracy.

Explicit profile answers, source exclusions, and diversity settings take priority.
Learning can be disabled or reset in profile settings. Memory selection and
numeric effects honor the toggle/reset and exclude feedback older than 180 days.
Raw feedback remains
available for audit and export; derived topic adjustments are reproducible from
that record. Never learn from clicks alone or from the AI's own generated text.
Feed refresh must not invoke the legacy consolidation that can replace explicit
profile answers.

## Preference-learning slice 1: weighted-v2 (2026-09-05)

No new storage authority or Python runtime is introduced. Structured preferences
are reconstructed from each canonical record: facet, permitted effect, scope
`related_papers`, horizon `current`, original note and snapshot, source key/time.
No automatic enduring preference or project scope is inferred. Settings labels
the preference facet and whether saved learning controls have deactivated it.

The existing assessment stage returns at most three memory matches per candidate,
with memory key, facet, effect, close/related relationship, and two 8–160-character
evidence excerpts. Code rejects wrong-sign/wrong-facet matches, unknown or duplicate
keys and missing source quotes. Custom effects must cite the user's verbatim note.
The AI never chooses a numeric adjustment. Baseline relevance is assessed without
negative-feedback penalties to avoid counting them twice. Method/population
memory effects do not depend on the profile's `hasApproach` heuristic.

- Close positive/reason-specific effects: +/-8 points; bare dislike: -4 points.
  Related matches: half strength. All decay over 30 days and expire at 180 days.
  Opposing examples sum; non-freshness influence is capped at +/-20 points. The
  legacy +/-5 topic bonus is not stacked on top. These are evaluation defaults.
- Age feedback only changes the matching candidate's recency half-life:
  `round1(14 / (1 + strongestDecayedMatch))`, between 7 and 14 days. Missing dates
  remain unknown. Topic grades, baseline weights and retrieval windows are intact.
- A soft dislike no longer excludes even its exact paper on the next refresh.
  Saved papers, explicit Dismiss and Already read still have their own exclusions.
- Evidence fields enlarge output, so memory-enabled batches use ten candidates
  instead of twenty within the existing 8,192-token completion limit. No extra
  extraction call is added to feedback capture or as a separate feed stage.
- Per-card `memoryEffects` and `recencyHalfLifeDays` expose actual applied effects;
  run-level `memoryStatus` separates off/none/checked/incomplete. Missing matches
  warn and leave their effects unapplied. `checked` means the response supplied
  the match field and its applied evidence passed validation, not semantic truth.
- Existing weighted-v1 caches remain readable. Canonical feedback is unchanged,
  so export/import and History Undo rebuild preferences without a stale index.

This slice does not implement semantic embeddings, automatic free-text memory
merging, enduring/project-scoped memory editing, or data-trained weight updates.
Those need a versioned embedding/runtime choice and human-rated evaluation.
The design borrows patterns, not code, from
[PaperFlow's profile updater](https://github.com/OpenRaiser/PaperFlow/blob/4a835e737490785b3ce51025c85b630cd224318c/skills/profile-updater/scripts/update_profile.py)
and [PAHF's feedback memory loop](https://github.com/facebookresearch/PAHF/blob/7a11213360a82d5f437a035e3a31c92d6307f8cf/agents/shopping_agent.py).

## Pipeline and evidence

1. Assemble explicit research context and bounded feedback adjustments.
2. Plan source-specific searches; preserve the requested source.
3. Retrieve concurrently with deadlines and visible per-source failures.
4. Interleave queries, merge identifier aliases, exclude saved/dismissed work,
   and cap candidates only after balancing the retrieval pool.
5. Assess bounded title/abstract text using a fixed evidence-bearing rubric.
6. Compute weighted scores in code and apply a relevance threshold.
7. Select a non-redundant, interest-aware set with deterministic tie-breaking.
8. Persist a versioned result with score and retrieval provenance; render it
   without an additional prose-generation call. Preserve the old cache on a
   failed run; a clearly labeled unranked fallback may retain retrieved results.

## Evaluation and limits

Use fixed clocks, recorded candidate pools, mock providers, and disposable vaults
for regression tests. Test missing metadata, partial source failures, ungrounded
AI scores, duplicate versions, ranking failure, feedback Undo/reset/disable,
profile conflicts, and legacy cache loading. Human evaluation must compare useful
papers in the top 12, topic coverage, repetition, recency, latency, and cost.
Paid-provider tests, real venue-data licensing/integration, and statistically
validated weight optimization are separate acceptance gates.

References: [DORA](https://sfdora.org/read/),
[MMR](https://www.cs.cmu.edu/afs/cs/Web/People/jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf),
[OpenAlex source metrics](https://help.openalex.org/data/sources/attributes/),
[ICORE](https://www.core.edu.au/icore-portal).
