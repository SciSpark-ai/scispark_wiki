# SciSpark Paper Manager

SciSpark is a local-first, AI-assisted research radar and personal knowledge
base. It helps researchers discover papers, read and annotate source material,
turn evidence into a Markdown wiki, ask grounded questions, and develop research
ideas while keeping the vault and API keys on the user's machine.

## Current status

SciSpark is an internal alpha moving toward a local beta. The core research
workflows, Projects, scoped chat, and recoverable History are real and
vault-backed. SP6 developer-preview hardening is implemented; paid-provider,
PDF-reader, tag, and prerelease-publication gates remain separate approvals.

| Surface | Status |
|---|---|
| Search, paper pages, digest, ingest, wiki, review inbox | Vault-backed |
| Personalized feed, profile, companion, trending | Vault-backed |
| Reader, highlights, select-to-ask | Vault-backed |
| Knowledge-base chat and saved answers | Vault-backed |
| Projects, membership, and project notes | Vault-backed |
| Visualization, Spark, lint, spend tracking | Vault-backed |
| Conversation history | Vault-backed |
| Project-scoped chat and Changes History UI | Vault-backed |
| Legacy Library route | Redirects to the saved-paper Wiki shelf |

See [project_memory.md](./project_memory.md) for the verified repository baseline
and [docs/design/06-roadmap.md](./docs/design/06-roadmap.md) for the execution
roadmap. Source-preview installation, backup, security, and known limits are in
[docs/DEVELOPER_PREVIEW.md](./docs/DEVELOPER_PREVIEW.md).

## Runtime model

The browser is the UI. A local Next.js server owns the runtime:

```text
Browser UI
   │ same-origin API calls
   ▼
Local Next.js runtime
   ├── filesystem Markdown vault
   ├── LLM skill orchestration and usage metering
   ├── server-held BYOK settings
   └── paper search, resolve, fetch, and citation relays
```

The default vault is `~/SciSpark/vault`. Set `SCISPARK_VAULT` to use another
folder. Agent-authored vault mutations use validated, conflict-checked
changesets with persisted undo records. Derived wiki, trend, timeline, and graph
views are rebuilt from the vault instead of becoming separate sources of truth.

Stored LLM keys are never returned to the browser. The settings API exposes only
presence flags, the generic vault-file API blocks access to
`.scispark/settings.json`, and persisted changeset records cannot be forged or
deleted through generic file mutations.

## Stack

- Next.js 16.3 App Router, React 19.2, and strict TypeScript 5
- Tailwind CSS 4 with semantic theme tokens
- Zustand for remaining client-only UI state
- Vitest 4 and jsdom for unit/component tests; Playwright for disposable-vault
  browser acceptance
- Zod schemas and Anthropic/OpenAI-compatible LLM providers
- Sigma.js, Graphology, and D3 for research visualizations
- pdf.js and DOMPurify for the reader

This Next.js version includes breaking API and file-layout changes. Read
[AGENTS.md](./AGENTS.md) and the relevant installed guide under
`node_modules/next/dist/docs/` before changing Next.js code.

## Getting started

Requirements: Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .env.local   # optional public-data credentials
npm run dev
```

Open <http://127.0.0.1:3000>. Meet Sparky, complete your research profile, and
connect your own AI provider in the guided setup. After the connection test,
SciSpark starts the first feed with visible progress. Normal use does not
require placing an LLM key in `.env.local`.

For a production-mode local run:

```bash
npm run build
npm run preview
```

Geist, Geist Mono, and Halant are bundled in the repository and served by the
local app. Builds do not download fonts from Google, and browsers make no
external font requests. Font sources, checksums, and redistribution licenses are
documented in [src/assets/fonts/README.md](./src/assets/fonts/README.md).

The v1 trust model assumes a loopback-only local server. There is currently no
local auth token, so do not bind the app to a public or shared network interface.

## Verification commands

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run e2e
```

Install the browser runtime once with `npx playwright install chromium`. E2E
uses a temporary disposable vault and local no-cost fake provider; it never
opens the normal user vault.

To run those same browser tests against a production build instead of the dev
server, use an isolated output directory (leaving your running app untouched):

```bash
SCISPARK_LIVE_GATE_DIST_DIR=.next-production-check npm run build
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-production-check npm run e2e
```

The test runner starts its own loopback server and disposable vault, then shuts
them down. It leaves the supplied production build intact. The import-graph
regression test follows browser dependencies through shared helpers to keep
server-only AI/provider code out of the client bundle.

Live LLM tests use real credentials, network services, and money. They are
environment-gated and must be run as explicit release gates, not as ordinary
unit tests. The relevant milestone plan documents the required variables and
acceptance assertions.

## Optional public-data credentials

| Variable | Required? | Purpose |
|---|---|---|
| `SCISPARK_VAULT` | No | Override the default `~/SciSpark/vault` location |
| `OPENALEX_MAILTO` | Recommended | OpenAlex polite-pool contact |
| `OPENALEX_API_KEY` | No | Higher OpenAlex credit allowance |
| `UNPAYWALL_EMAIL` | Required for Unpaywall resolution | Contact required by Unpaywall |
| `S2_API_KEY` | No | Higher Semantic Scholar limits and citation lookup |
| `NCBI_API_KEY` | No | Higher PubMed limits |

## How the recommendation feed works

The feed uses a reusable, versioned pipeline (`weighted-v2`), not a single prompt
asking an AI to pick papers. Its initial weights are **70% relevance, 20% recency,
10% venue standing**. These are testable product defaults, not validated measures
of research quality or probabilities that a researcher will like a paper.

```text
Explicit profile + bounded feedback
  → source-specific search plan
  → parallel retrieval → balanced candidates → deduplication / exclusions
  → evidence-bearing relevance assessment
  → deterministic weighted score → diversity-aware selection
  → persisted feed, score breakdown and source provenance
                         ↑
                 explicit user feedback
```

### Retrieval and relevance

1. The configured strong-tier model plans 1–8 searches around the user's fields,
   active topics and feed preferences. The selected exploration mode guides how
   narrowly or broadly to search. Planning failure falls back to explicit-topic
   OpenAlex/PubMed queries with a visible warning.
2. The live feed calls **arXiv, OpenAlex, Semantic Scholar and PubMed as requested**;
   it does not silently relabel one index as another. Queries run concurrently,
   requesting 25 results each with native publication-date filters. Each source
   has a 20-second waiting deadline and visible failure diagnostics. The deadline
   bounds the pipeline's wait; it does not abort an underlying adapter request.
3. The main window starts 14 days before the refresh date. If fewer than ten
   dated candidates remain, retrieval widens once to 90 days. Exact dates are
   checked locally; future/out-of-window papers are excluded. Partial or missing
   dates are labeled unknown, not assigned a fabricated day. A known year outside
   the retrieval years is excluded even if the full date is absent.
4. Query results are interleaved, shared identifiers are merged, and saved or
   explicitly dismissed papers are excluded. Normalized-title matching is used
   when a DOI is missing, but conflicting DOIs are not merged. After date grouping,
   at most 50 candidates proceed to assessment. This is a bounded discovery feed,
   not an exhaustive systematic-review search.
5. The configured fast-tier model assesses batches of up to 20 candidates (10
   when preference memories are present, to leave room for evidence pairs) from
   their titles and the first 2,000 abstract characters. Venue and citation fields
   are withheld. Each dimension receives an anchored integer grade:

   | Grade | Meaning |
   |---|---|
   | 0 | Unrelated |
   | 1 | Weak or adjacent fit |
   | 2 | Useful partial fit |
   | 3 | Strong fit |
   | 4 | Directly addresses the stated interest |

   Relevance combines current-question fit (50%), best matching topic (30%), and
   approach fit (20%). Applicable weights are renormalized when preferences are
   unspecified. In this version, active topics supply the question context;
   approach grading is enabled when feed preferences mention methods, populations,
   datasets or supported article-type terms. This heuristic is intentionally
   simple and is a candidate for human evaluation. Learned method/population
   preferences have a separate evidence-bearing scoring channel, so they work
   even when the profile has no explicit approach preference. Negative feedback
   must not also reduce baseline grades: its effect is computed separately.

   Positive grades must cite an 8–400-character excerpt found in that candidate's
   source text (case/whitespace normalized); unsupported grades become zero.
   Papers below 50/100 relevance, or assessed as violating explicit preferences,
   are removed. An excerpt proves provenance, **not** that an AI's semantic
   judgment is correct. Title-only assessments are labeled; full texts are not
   used for this stage. Free-text preference exclusions are model-assessed, not
   a guarantee of metadata-complete filtering.

### Scoring and diversity

For eligible papers, the code computes:

```text
recency = 100 × 2 ^ (−ageInDays / halfLifeDays)
score   = clamp(0.70 × relevance + 0.20 × recency
                + 0.10 × venue + feedbackAdjustment, 0, 100)
```

The default half-life is 14 days. An evidence-backed “too old” preference narrows
it only for a matching subject: `halfLifeDays = 14 / (1 + strength)`, rounded to
one decimal, bounded to 7–14 days. Strength is 1 for a close match or 0.5 for a
related match, decayed with a 30-day half-life. Multiple age votes use the strongest
match, not a compounded penalty. This changes recency, never topical relevance or
the source's publication date. Retrieval still uses the visible 14/90-day windows.

An unknown date gets no freshness bonus. An unknown venue receives neutral 50
(five points in the final score), displayed as unknown rather than a guessed
impact factor. Currently the live app has **no JIF or conference-ranking dataset
connected**. The pipeline accepts optional trusted `venueSignals`, keyed by paper
ID, with a normalized 0–100 score, source, metric name, year, comparison cohort
and provenance URL. Connecting a licensed/appropriate dataset and validating
cross-field normalization remain separate work. OpenAlex citedness is not JIF;
venue prestige must not be presented as paper quality.

Selection returns up to 12 papers. Recent, older and undated groups are filled in
that order, so a score is compared within a date group rather than allowing old
work to displace the fresh feed. A deterministic, MMR-style greedy step discounts
redundancy with already selected papers using title-token overlap and shared
matched topics. Focused / Balanced / Exploratory use redundancy penalties of
3 / 10 / 18 points respectively. Diversity changes selection, not the displayed
base score, and cannot rescue a paper below the relevance threshold. It is a
lightweight heuristic, not embedding-based semantic coverage or guaranteed quotas.

### Does it learn from feedback?

Yes—**reason-aware memory shapes searches and evidence-backed ranking effects**.
The last onboarding step's **Feed preferences** button, Profile and Settings →
Recommendations expose exploration mode and the learning toggle. Settings/Profile
also offer Reset; changes apply on Save
and affect the next refresh. Disabling learning stops adaptation but does not
undo a user's individual paper dismissals.

- Thumbs up saves a positive paper example. Thumbs down first saves a negative
  example without hiding the paper, then Sparky asks an optional “What missed the mark?”
  question at the bottom right. Options cover topic, method, age, already read,
  and Something else, with an optional 600-character note. Skip keeps the original
  thumbs down without inventing a reason. No LLM call is required for this exchange.
- Votes and reasons leave the current feed unchanged, including after navigation
  or reload. Only **Dismiss** hides a current card; History can undo it. Feedback
  shapes future refreshes, which may select a different set of papers.
- Save preference records the reason and exact user note with a server-owned
  title/abstract/topic/date snapshot. A revision-checked follow-up still works
  after the feed cache changes. Stale questions return a conflict instead of
  overwriting newer feedback. History can undo the refinement and original vote.
- The next refresh reconstructs a feed-specific memory view from these records.
  A single example is usable immediately. Planning reads relevant memories;
  each assessment batch selects its own context using title/abstract/note word overlap and
  a recency preference, balancing positive and negative examples. Each selection
  is capped at 24 records / 18,000 serialized characters. This is a lightweight
  memory selector, not embedding-based retrieval or a trained ranking model.
  Research abbreviations such as EEG and MRI are retained. Memories carry a
  structured facet (example, topic, approach, recency or custom), permitted effect,
  related-paper scope, current-preference horizon and source feedback timestamp.
  They are derived from the canonical votes, not stored as an independent summary
  that could survive Undo or silently overwrite an explicit profile answer.
- Positive examples can introduce new interests; negative examples reduce close
  matches according to the reason given. Method feedback must not be mistaken for
  topic dislike. “Too old” is freshness feedback. “Already read” and ordinary
  dismissal suppress that paper on future refreshes without entering preference inference. Clicks
  and reading time do not train the feed. Thumbs down, topic, method and age votes
  are not automatic paper exclusions, even on future refreshes. Soft feedback
  does not create hard bans.
- Settings → Recommendations → Your feed memory shows saved responses. Refresh
  metadata records the union of memory paper IDs supplied to planning/assessment;
  this proves which context was supplied, not that a model followed it correctly.
  Each ranked card also exposes applied memory IDs/timestamps, the saved evidence,
  candidate evidence and resulting score adjustment. Missing or invalid match
  outputs produce a visible incomplete-learning warning, not a fabricated effect.
- In the same assessment stage, the AI proposes at most three semantic memory
  matches per candidate. Code verifies the memory belongs to this batch, both
  quoted excerpts exist (8–160 characters each), and the effect matches the saved
  reason. Custom preferences must quote the user's note. Duplicate memory IDs do
  not multiply influence; unsupported matches are discarded. Evidence verifies
  provenance, not semantic correctness; that still needs human evaluation.
- A close match to a positive or reason-specific preference contributes ±8 score
  points; an unexplained dislike contributes −4. Related matches have half that
  strength. Votes decay with a 30-day half-life and expire after 180 days. Opposing
  examples sum rather than silently erasing each other; the aggregate non-freshness
  adjustment is capped at ±20. One vote is usable immediately. These are initial
  policy constants for evaluation, not statistically learned optimal weights.
  The legacy ±5 topic helper is retained for old callers but is not used by the
  live v2 pipeline. The 70/20/10 weights, explicit answers and diversity mode are
  not automatically rewritten.
- Reset ignores votes at or before its timestamp for learning; it does not erase
  audit history or restore individually hidden papers. History → Changes → Undo
  can reverse a feedback mutation, provided the record has not since changed.

Feedback is stored in `profile/recommendation-feedback.json` (up to 2,000 latest
paper votes). The API accepts a persisted paper key, supported reason, optional
note and follow-up revision; paper snapshots and timestamps are server-owned. Writes are atomic changesets,
with conflicts reported as `409`. Corrupt feedback is preserved, learning pauses,
and the app reports a warning. Feedback and profile settings travel with normal
vault export/import; this is local personalization, not shared model training.

### Transparency, fallbacks and reuse

The generated feed is cached at `.scispark/feed/latest.json`. Each new item keeps
its component scores, evidence excerpts, matched interests, date certainty and
source/query provenance. The feed exposes retrieval windows, failures and applied
memory effects. There is **no mandatory second pass generating persuasive
“why this / why you / why now” prose**. Old caches remain readable.

If assessment fails or omits candidates, results are explicitly unranked with a
warning that preferences have not been fully checked. An existing cache is not
overwritten by that fallback. An all-irrelevant run likewise preserves the cache;
zero retrieved candidates produces an actionable error. Unranked results are
shown for inspection, not as recommendations with invented scores.

Reuse within the TypeScript codebase:

- `src/lib/recommendation/contract.ts`: versioned schemas and preference contract.
- `src/lib/recommendation/engine.ts`: storage-free retrieval, scoring, feedback
  derivation and selection functions with injectable search and clock.
- `src/lib/recommendation/assessment-skill.ts`: replaceable, storage-free AI rubric.
- `src/lib/recommendation/preference-effects.ts`: reason validation, evidence
  verification, independent-example counting, decay and feedback-effect policy.
- `src/lib/skills/feed-cache.ts`: browser-safe schemas and persisted-feed reader,
  with no provider/runtime value imports.
- `src/lib/skills/feed.ts`: `runFeed(storage, {searchFn, providerOverride?, now?,
  venueSignals?})` composes the stages, meters usage and persists the result.
- `src/lib/recommendation/feedback.ts`: atomic explicit-feedback persistence.
- `src/lib/usermodel/feed-memory.ts`: reason-aware, budgeted memory selection for
  feed planning and relevance assessment; no duplicated summary file to drift.

This is an internal reusable module, not a published npm package. Deterministic
fixtures test the engine and full orchestration; disposable-vault browser tests
cover controls, feedback, reloads and History Undo. They do not establish live
provider reliability or prove the initial weights are optimal. Before tuning
weights automatically, collect human relevance judgments and compare top-12
usefulness, topic coverage, repetition, latency and cost against this baseline.
See the [design contract](./docs/design/07-recommendation-pipeline.md).

The first preference-learning slice adapts the feedback/ranking and memory-loop
ideas investigated in [PaperFlow](https://github.com/OpenRaiser/PaperFlow) and
[PAHF](https://github.com/facebookresearch/PAHF), without importing their Python
runtimes. Semantic embedding retrieval, enduring/project-scoped preference
management, calibrated adaptive weights and venue-data integration remain future
work. Feedback processing adds no model call at button-click time; ranking still
uses the metered assessment stage, with smaller batches when evidence is needed.

## Repository layout

```text
src/app/          App Router pages and local API routes
src/components/   Product UI and interaction components
src/lib/chat/     Grounded KB chat and session persistence
src/lib/llm/      Provider abstraction, settings, budgets, metering
src/lib/skills/   Pure skill definitions and shared runner
src/lib/vault/    Storage adapters, schemas, bundles, changesets
src/lib/wiki/     Ingest, authoring, review, lint, derived dashboards
src/lib/papers/   Search providers, normalization, resolution
src/lib/recommendation/ Reusable feed ranking, diversity and feedback learning
src/lib/spark/    Quick and Deep research-idea workflows
src/lib/trending/ Deterministic trend metrics and qualitative surveys
docs/design/      Product and architecture decisions
docs/superpowers/ Milestone specifications and implementation plans
```

## Engineering rules

- Preserve the browser/server boundary. Client modules must not import
  filesystem, secret, or server-only code.
- Keep skills storage-free. Orchestrators own persistence, filtering,
  degradation, metering, and atomic changesets.
- Make vault mutations schema-validated, atomic, and undoable.
- Use semantic CSS tokens rather than raw component colors.
- Add focused regression tests for behavior changes.

See [CLAUDE.md](./CLAUDE.md) for the detailed decision ledger and
[AGENTS.md](./AGENTS.md) for the concise working contract.
