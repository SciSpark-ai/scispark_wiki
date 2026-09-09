# Personalized literature review and unified Sparky workspace

Date: 2026-09-07

Status: the user subsequently requested resuming full integration. The ScholarQA
adaptation and bounded claim correction/re-audit are now wired into the local
product as an **integrated preview**, not a declaration that Phase 0's broader
scientific-quality gate passed. Phases 2–4 now have executable brief/context,
server-owned jobs, reservations, evidence acquisition/gap retrieval, PDF input,
versioned report, History, export and KB paths. Phase 5 verification is ongoing;
fixture/browser/build results and remaining live limitations are recorded in
[integration verification](../../testing/2026-09-07-deep-review-integration.md).
The earlier saved pilot's 35 corrected claims passed automated checks, not
independent scientific acceptance. Preserve the quality gates below; do not
equate integration with validated review quality. See also the historical
[foundation and evaluation record](../../testing/2026-09-07-literature-review-foundation.md).

The user separately approved configured-provider tests in a disposable vault with
a $2 total estimated allowance. On September 7 the user supplied GMI pricing for
`google/gemini-3.8-flash`: $0.75/M input, $3.75/M output, $0.075/M cache reads.
These endpoint-specific user quotes resolve the pricing blocker; they are not
assumed to be Google's direct API prices. Live evaluation uses one persistent
cumulative allowance ledger, with full-input reservations before each attempt.
See the evaluation record for current spend and results. No active-vault changes.

## 1. Product outcome

Sparky should investigate a research question and produce a substantial,
editable, evidence-grounded literature review. The user should understand the
evidence well enough to guide research and draft their own related-work section.

The output is an integrated research brief, not merely a ranked paper list or a
long chatbot answer. It includes a thematic synthesis, study-comparison table,
agreements and contradictions, limitations, unanswered questions, traceable
citations, and a separate discussion of relevance to the user's research.

## 2. Agreed scope

| Decision | Agreed behavior |
| --- | --- |
| Entry point | Merge Search and Chat into one Sparky conversation workspace. Ordinary chat can find papers; Deep literature review is an explicit mode in the same composer. |
| Before research | Ask only necessary clarifying questions. Show an inline review brief and wait for Start review; no separate setup modal. |
| Brief | Include the research question, scope, relevant population/method/date constraints and exclusions, personal-context assumptions, models, and budget. |
| Evidence access | Include relevant abstract-only papers with explicit limitations. Never infer unreported details. Allow a legally obtained PDF upload to deepen analysis. |
| Cost | Configurable per-review estimated allowance, initially $2 and provisional pending evaluation, alongside the existing daily budget. Estimates depend on the actual models and workload. No silent model substitution. |
| Personal context | Current conversation, relevant profile/interests and preference memories. Project reviews use that project's papers/notes; general reviews retrieve relevant material across the vault. |
| Prior conversations | Use deliberately remembered relevant context, not an unrestricted search of all past conversations. |
| Memory versus evidence | Personal context shapes scope and interpretation; it cannot justify scientific claims or suppress important conflicting evidence. |
| Persistence | All AI chat conversations, including literature reviews, are automatically recorded in conversation History. Save questions, replies, approved briefs, paper results, run status, reports, and revisions without a separate Save action. Reopening does not rerun paid work. |
| Background work | Continue when a tab closes or the user navigates away, while the local server is alive. After server restart, offer Resume from the last durable checkpoint. |
| Notifications | At most one completion notification per run, respecting the existing quiet-companion delivery rules. |
| Cancellation | Cancel future work and preserve useful partial results. |
| Editing | Editable report alongside chat, conversational revisions, and saved versions rather than destructive overwrite. |
| Reuse | Reopen and continue any literature review from its automatically saved conversation in History. Markdown/BibTeX export and Add to knowledge base are optional additional actions, never prerequisites for retaining the review. |

Out of scope for this release: formal systematic-review or PRISMA-completeness
claims, automated meta-analysis, submission-ready manuscripts, journal-specific
formatting, a full Word-style editor, cloud execution while the local server is
off, a replacement profile/memory service, and training a new research model.

## 3. Verified starting points and gaps

Planning baseline checked on 2026-09-07, before the Phase 1 changes above:

- `src/app/papers/page.tsx` holds its result in component state. It logs planned
  source queries but does not create a recoverable search conversation.
- `src/lib/skills/research-search.ts` already plans source-specific searches,
  deduplicates and ranks results, and uses user context. Its small, quick-search
  retrieval/ranking limits are not a deep-review coverage policy.
- `src/lib/chat/session.ts` persists sessions under `.scispark/chats/` and
  validates their shape. Messages currently hold text and citation/error metadata,
  not rich search-result or review-artifact blocks.
- `src/lib/chat/orchestrator.ts` saves the question before answering, supports
  project scope, validates citations to selected wiki pages, and limits prior
  conversational context to six turns. Saved history is not equivalent to a
  complete review working context.
- `src/components/history/HistoryPageClient.tsx` already lists conversations and
  changes. Extend this instead of creating an unrelated research-history store.
- `src/lib/usermodel/context.ts` assembles profile, interests, standing
  instructions, activity, and library context. A review-specific selector must
  honor the narrower agreed context boundary rather than blindly forwarding it.
- `src/lib/usermodel/feed-memory.ts` derives reason-aware preferences from
  canonical feedback. It respects learning-off, reset, and expiry, but its
  feed-oriented boost/reduce guidance must not become review exclusion rules.
- Paper adapters, source selections/personal keys, eligibility checks, safe
  acquisition, and source pacing already exist under `src/lib/papers/` and
  `src/lib/server/`. Reuse them; verify new passage/citation endpoints use the
  same controls.
- `src/lib/server/skill-route.ts` streams NDJSON and guards disconnected clients.
  It is not a durable job queue or restart/checkpoint mechanism.
- `src/lib/llm/metering.ts` accounts for model-priced usage and daily limits.
  Unknown prices remain unknown. Current checks are not per-run reservations
  that can guarantee a cap across concurrent calls and retries.
- `NodeFsVaultStorage` uses temporary-file/rename writes. Atomic individual writes
  do not by themselves make a multi-file run checkpoint transactional.
- `src/lib/vault/export.ts` exports vault files while excluding settings. New
  run/checkpoint files must never introduce additional secret-bearing exports.

Existing guide constraints remain: local server owns storage and credentials;
skills do not write directly to the vault; semantic theme tokens; validated,
undoable knowledge mutations; no unrestricted network or filesystem tools.
Do not introduce a hosted embedding index for private memory. Public-paper
retrieval/reranking dependencies must be explicitly assessed in the engine trial.

## 4. Open-source reuse: decision gate before integration

Evaluate an actual academic synthesis pipeline, not a general agent framework.
Do not start the previously suggested DeepAgentsJS integration.

### Candidate A: Ai2 ScholarQA

[Official code and documentation](https://github.com/allenai/ai2-scholarqa-lib)
describe an Apache-2.0 Python library with replaceable retrieval/reranking and
evidence-selection, organization, synthesis, and comparison-table components.
Its default retrieval uses Semantic Scholar passages and metadata. It is the
first practical integration candidate, not an already chosen dependency.

Prove passage-endpoint access under ordinary user credentials, replacement of
retrieval with SciSpark source tools, model compatibility, incremental execution,
and evidence provenance. Do not equate the hosted demo's capabilities or corpus
access with the public package.

### Candidate B: OpenScholar

[Official code and documentation](https://github.com/AkariAsai/OpenScholar)
describe an Apache-2.0 scientific synthesis pipeline with iterative self-feedback,
additional retrieval, and citation attribution. Its full retrieval index has
substantial infrastructure requirements; the documented inference flow also
supports external API retrieval and API-served models.

Assess whether useful pipeline components can operate on our retrieved papers
without hosting its enormous index or training a model. Verify the current API
path, rather than assuming a planned retrieval API is available.

### Trial and selection criteria

Use the same approved questions, evidence fixtures, model configuration and
budget policy for both candidates. Pin the evaluated revisions and document
exactly which upstream modules are reused versus adapted. Do not build two
production engines or a general-purpose plugin marketplace in v1.

The trial must establish:

1. Scientific evidence quality, source traceability, cross-study comparison and
   handling of conflicting or incomplete findings.
2. Genuine follow-up retrieval when evidence is insufficient, not just one
   search followed by a lengthy answer. Record any missing control logic we
   must add around the reused component.
3. Compatibility with configured BYOK models, including an OpenAI-compatible
   provider, without requiring an unrelated Anthropic key or silent fallback.
4. Every model/search call can pass through SciSpark's metering, source allowlist,
   pacing, cancellation, and privacy boundary. No unmetered engine-internal calls.
5. Checkpointable intermediate outputs and resumability without repeating
   completed research stages.
6. Install footprint, supported runtime, license notices, dependency security,
   and local packaging. Do not assume a Python sidecar is already supported by
   the current Node-only application scripts.

Start with deterministic fixtures. A live comparison is a separately authorized,
cost-bearing gate against a disposable vault. If neither candidate satisfies
these requirements without replacing most of its core, document that result and
revisit the engine decision; do not silently revert to a from-scratch framework.

## 5. Proposed system boundaries

### Conversation workspace

Extend the existing chat session format compatibly with typed blocks for paper
results, review briefs, run links, and report-version links. Keep existing text
messages, project identity, citations, and error states readable.

Automatic conversation History is the default for every AI chat mode, including
literature review, not an optional reuse feature. Record the conversation and its
linked review artifacts as work progresses, including partial, cancelled and
failed runs. Reopening the same conversation restores its questions, replies,
approved brief, paper results, run status, report and revision history. Continuing
from History stays in that conversation; merely viewing it never restarts work.
No export, Add to knowledge base, or separate Save click is required.

Recording a conversation in History is distinct from selecting it as personal
memory for other conversations. Automatic recording does not authorize sweeping
all past chats into a future review's context.

Persist the original question and operation ID before retrieval. Store server-owned
paper snapshots with stable identifiers, source provenance, and retrieval time;
do not store only IDs into an expiring feed cache. Reloading or navigating back
restores results without another model call. A new search/refinement creates a
new persisted result version instead of erasing the old result set.

Make `/chat` and `/chat/[id]` the unified workspace. Retain `/papers` compatibility,
including its current `paperKey` resolution behavior, and update internal links
and the sidebar. Do not redirect old links until their destination behavior is
covered by tests. Existing ephemeral searches cannot be reconstructed from
query-only logs; capture any still-mounted result on transition where possible,
and do not manufacture lost historical results.

Keep the composer visible and the message/report areas independently scrollable.
Desktop can show chat and report side by side; narrow screens switch views
without losing drafts, run progress or scroll state. Preserve accessible controls,
light/dark contrast, current card feedback, and the user's short-copy wrapping rule.

### Review context and approval

Build a bounded, query-specific context packet with provenance for each selected
profile/preference/project item. An explicit question overrides inferred interests.
Project scope is a real private-source boundary, not just a prompt instruction.
Do not expand a deleted/missing project into a global-vault search.

Derive review guidance from canonical preferences without copying feed penalties:
wrong-method feedback is not topic dislike; freshness feedback does not ban
foundational work; already-read papers can remain essential evidence. Never
silently hide a contradictory study because it scores poorly for personal taste.

The approved brief freezes a versioned research scope, contextual assumptions,
allowed sources, model choices and allowance. It is a control-plane document,
separate from retrieved paper text. Scope or model changes requiring new work
create an amended brief for approval. No deep run starts merely by selecting
the mode or opening History. Brief preparation uses normal metered chat calls;
the expensive review pipeline starts only on explicit approval.

Memory is still canonical in SciSpark. Reports and model-generated summaries
do not automatically become preferences or deliberately remembered conversation
facts. Local storage does not imply local inference: disclose that selected
context reaches the user's configured provider; send only appropriate search
terms, not personal notes/profile dumps, to external paper indexes.

### Local jobs and checkpoints

Proposed durable states: awaiting approval, queued, running, paused for budget or
authorization changes, interrupted, completed, partial, cancelled, and failed.
Persist research stage separately: search, acquire/read, compare, gap search,
synthesize, and verify.

- Start returns a stable run ID promptly. The browser subscribes to persisted
  events/snapshots; it does not own the task's lifetime. Reuse NDJSON with a
  sequence cursor and reconnect/poll recovery rather than duplicating the
  transport unnecessarily.
- A local coordinator owns execution and leases, with one active deep-review
  job per vault initially. A scoped engine helper may be needed after selection;
  it must not independently write the vault or bypass metering/source controls.
- Use versioned manifests pointing to immutable completed-step outputs. Publish
  the manifest atomically only after its referenced outputs exist. Validate
  checkpoint shapes and isolate corrupt/incomplete writes.
- Use idempotent Start/Resume/Cancel requests and revision checks. Concurrent
  tabs, dev reloads and duplicate processes must not claim the same run twice.
  Existing process-local promise queues alone are insufficient ownership proof.
- Startup reconciles stale leases to interrupted state; it does not automatically
  begin new paid calls. Resume rechecks project access, current source settings,
  budget, model configuration, and revoked memory permissions.
- Completed provider steps are reused. An interrupted in-flight call can have
  incurred cost without returning a result; record that uncertainty and never
  promise exactly-once provider billing or silently replay an uncertain call.
- Cancel stops scheduling new work and aborts supported in-flight requests;
  already consumed tokens remain billable. Save partial evidence/report output.
- Emit one persisted completion event through existing companion delivery rules.

The installed Next.js `after` documentation describes response-lifetime background
work with duration limits. It is not a restartable queue. A lone `after` callback
or detached promise is not sufficient for this requirement. Validate coordinator
lifecycle against the supported local dev/start commands before UI integration.

### Model-aware budgets

Keep fast/strong tier configuration and actual selected model IDs visible in the
brief. Do not bake a library's default model into the feature. Preserve supported
reasoning settings rather than disabling thinking to fit an arbitrary token cap.

Introduce run-level usage/allowance accounting tied to the shared daily ledger.
Reserve a conservative amount for each scheduled provider attempt, including
retries and planned synthesis, then reconcile reported usage. Other simultaneous
features must not spend the same remaining daily allowance independently.

The initial $2 allowance is configurable and provisional. Present a model-aware
estimate with uncertainty, not a guaranteed review price, duration, or paper
count. Account for input/output and available cached/reasoning token details
without double counting. Unknown model prices/usage are never zero. Pause for
pricing or explicit bounded-work authorization when a dollar allowance cannot
be meaningfully enforced; disclose reliance on provider-side billing limits.
Distinguish paper-service charges, if any, from the AI allowance.

At an allowance boundary, preserve partial work and ask before extending it.
Provider uncertainty and unavoidable in-flight cost must be visible. A budget-
limited result is not labeled as a completed comprehensive review.

### Evidence and synthesis

The chosen engine consumes normalized paper/evidence records through adapters:
search, resolve, acquire accessible text, read approved local material, and expand
references/citations where supported by enabled sources. Retain source-specific
rate limits, retries, timeouts and result diagnostics. Never treat all-source
failure as evidence that no literature exists.

Each evidence item records paper/version identity, retrieved source and timestamp,
access level (full text, abstract, or bibliographic metadata only), passage locator,
and content hash. Keep necessary excerpts only where permitted. A paywall,
network failure, and parsing failure are different conditions. Optional uploaded
PDFs require bounded validation and association with the correct paper/version.

Preserve publication eligibility and deduplication across indexes and preprint/
published versions. Reviews or retractions can provide context, but review
comments such as Reviewer #1 are not independent studies. Do not turn venue or
citation counts into study-quality evidence, or pool effects across incompatible
populations and methods without justification.

Extract a structured evidence table with supported findings, methods, populations,
limitations and missing fields. Use null/not reported rather than invention.
Revisit searches for unanswered parts of the approved brief and alternative
explanations. Do not directly reuse the feed's ranking weights, diversity quotas,
or quick search's small result cap as the review stopping rule.

Stop on adequate documented coverage or configured safety/resource bounds.
Operational search/iteration limits are provisional and must be measured during
the trial. Do not promise an arbitrary number of papers or exhaustive coverage.
Citation verification checks that references exist and cited passages support
their attached claims; merely counting citations is insufficient. Report remaining
gaps, access limitations and unsupported claims explicitly. No fake certainty
from a second model approving the first model's answer.

### Report artifacts, editing and knowledge-base reuse

The conversation in History automatically retains the review and links to its
artifacts and versions. Export and knowledge-base insertion provide additional
ways to reuse that retained work; neither action controls History persistence.

Persist Markdown report content plus structured evidence and reference manifests.
Use stable citation IDs and deterministic bibliography generation from retrieved
metadata. The model must not invent DOI, author, title or publication date fields.

Save report versions with parent revision, provenance and verification status.
Manual edits and conversational revisions are distinguishable; editing a claim
invalidates its prior verification status. A delayed AI revision must not overwrite
a newer user edit. Separate writing-only revisions from requests that require
additional searches and budget approval.

Export Markdown with portable citations and BibTeX with stable, escaped keys.
Standalone report exports omit private context packets and source-file originals
unless explicitly requested. Vault backup/restore retains run/artifact links but
never credentials and never starts restored jobs automatically.

Add to knowledge base uses existing schema routing and one validated, undoable
changeset, storing review provenance and references. It does not silently import
all referenced papers. Do not introduce a new wiki type without checking schema
compatibility. Keep conversation/report versions independent of KB Undo.

## 6. Delivery sequence and gates

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0. Engine feasibility | Small ScholarQA/OpenScholar comparison, pinned licenses/dependencies, model/source/metering/checkpoint adapter proof, evidence-quality rubric and selection record. | One reusable academic engine demonstrably fits; document remaining adaptations and runtime installation implications. No production dependency selection by assumption. |
| 1. Durable unified workspace | Compatible chat block schema, saved search snapshots, Search/Chat consolidation, history reopening, preserved old links and project scopes. | Search -> Home -> return, reload and History all restore identical results without new calls; legacy chats and paper links still work. |
| 2. Brief, context, jobs and budgets | Review mode, conversational scope approval, memory selector, durable coordinator/checkpoints, estimates/reservations and cancellation. | No unapproved execution; tab closure and server restart behave as agreed; concurrent starts and retries cannot duplicate ownership or lose accounting. |
| 3. Academic review pipeline | Integrate the selected upstream modules; evidence acquisition/extraction, gap retrieval, comparison, synthesis, citation validation and honest partial output. | Fixture and authorized live evidence checks pass; no source/credential/metering bypass. |
| 4. Report workspace | Editable report, safe revisions/version history, Markdown/BibTeX, explicit KB insertion and completion event. | Editing races, citation status, export/restore, KB Undo and one-time completion behavior verified. |
| 5. End-to-end acceptance | Disposable-vault browser walkthrough and separately approved live-model/source evaluation; documentation updates. | Exact-artifact verification covers the complete user journey and all release-critical failure cases below. |

Phase 1 is useful independently, but does not constitute delivery of the deep
review feature. Review contracts can be designed early; production engine
integration waits for Phase 0. Avoid implementing both candidate ecosystems.

## 7. Acceptance checklist

Use deterministic fixtures for routine tests and the existing `npm run e2e`
disposable-vault runner. Live academic queries and paid model calls require
separate bounded authorization; never test by modifying the active human vault.

- [ ] Unified chat handles a quick paper search and a follow-up referring to its
  results. Leaving, reloading, and History reopening preserve the conversation,
  paper snapshots, draft report and final versions without new paid calls.
- [ ] Complete and revise a literature review without exporting it, adding it to
  the knowledge base, or clicking any Save action. History automatically retains
  the conversation, brief, sources and report versions. Reopen and continue the
  same conversation; opening alone does not trigger research. Partial, cancelled
  and failed runs remain traceable there too.
- [ ] A new user's empty vault still supports online research after BYOK setup.
  Existing project/library chat and read-sources-only behavior stay intact;
  ambiguous local-versus-online intent is clarified rather than silently widened.
- [ ] Review approval records exact scope, model and allowance. Double-clicks,
  concurrent tabs, stale brief approvals and edited scope cannot start duplicate
  or incorrectly scoped runs.
- [ ] Broad, narrow, comparison and gap-oriented review fixtures exercise genuine
  multi-paper synthesis. Human inspection checks sampled material claims and
  study-table rows against actual passages. An independent unhelpful-profile
  control demonstrates that personal preferences do not bias conclusions.
- [ ] Explicit questions override interests. Project boundaries, remembered-
  conversation limits, learning-off, reset and revoked source permissions work.
  Model outputs do not become new user memories implicitly.
- [ ] Tests cover contradictory findings, missing methods, abstract-only evidence,
  unavailable full text, wrong-paper PDF upload, duplicate publication versions,
  reviewer comments, retraction flags, and injected instructions in paper text.
- [ ] Claims cite real, accessible-in-the-run evidence; unsupported claims are
  omitted or qualified. Metadata-only records are not presented as read studies.
  Personal implications are distinguished from literature findings.
- [ ] Source 429/timeouts, partial source failure and all-source failure preserve
  diagnostics and useful work. No infinite retry or false no-literature claim.
- [ ] Closing all browser tabs leaves the local job running. Process restart
  preserves checkpoints and offers Resume. Cancel, duplicate Resume, stale
  leases, corrupt manifests and uncertain provider completion are exercised.
- [ ] Small allowances, expensive models, unavailable pricing, failed structured
  output, retries and competing feature spend cannot silently bypass the budget.
  Switching model or expanding scope is explicit. Known and unknown cost remain
  distinguishable in UI and logs.
- [ ] Human edits are not overwritten by delayed AI revisions. Versions reopen,
  citation verification is invalidated when needed, and Markdown/BibTeX match
  the selected report version's source manifest.
- [ ] Report export and vault backup/restore preserve intended data and links,
  exclude secrets/private context from standalone reports, and do not resurrect
  running paid tasks. KB insertion/Undo cannot delete the conversation report.
- [ ] Inspect desktop/phone and light/dark in a real browser: fixed-height chat,
  visible composer, readable report/table, working citations, no overflow or
  stranded single-word short copy, and one quiet completion notification.
- [ ] Run focused regressions, full Vitest, typecheck, lint, production build and
  affected production/disposable-vault E2E. Document exact tested artifact and
  distinguish fixture gates from live evidence-quality acceptance.

During Phase 0, define and freeze the evaluation questions and scored rubric
before comparing engines. Candidate examples should include auditory neuroscience,
cross-method comparisons, pediatric versus adult scope, and an unrelated field.
Measure coverage, citation support, comparison accuracy, access disclosure,
personalization faithfulness, latency, token usage, and estimated cost. Do not use
general web-QA leaderboard scores as proof of literature-review quality.

## 8. Documentation and open technical decisions

At delivery, update README and product/harness documentation to distinguish
quick search, literature review and personalized feed; explain reusable pipeline
components, memory boundaries, scope approval, model-aware budgets, partial
results, persistence/resume and evidence limitations. Include notices for reused
upstream code and supported runtime installation instructions.

Technical decisions to resolve through Phase 0 and implementation design, not
additional generic onboarding questions:

- Which candidate's reusable components satisfy the review and metering contract.
- Whether a supervised Python helper is necessary and how it is packaged locally.
- Durable coordinator ownership/locking and shared usage reservations across
  supported process boundaries.
- Supported scholarly passage/full-text/citation endpoints under real user keys.
- Existing-compatible report editing/citation representation and upload parsing.
- Measured resource defaults and useful minimum evidence thresholds for each
  evaluated model configuration; $2 remains a provisional allowance.

If these checks require new paid infrastructure, private corpus access, unrestricted
vault access, changed privacy boundaries, or a material reduction in agreed review
quality, stop and bring that specific tradeoff back to the user.
