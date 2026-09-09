# SciSpark feature and runtime guide

Detailed behavior, configuration, and implementation notes for the current
local preview. Start with the [product overview](../README.md) for features and
the research workflow. Commands and source paths below are relative to the
repository root.

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

## Sparky conversations and recoverable paper searches

The sidebar now has one **Sparky** workspace. **Find papers** runs the existing
bounded AI search planner and ranker; **Discuss research** answers from saved
research or the latest search's paper abstracts. This is quick research search,
not an exhaustive literature review. `/papers` remains a compatible entry point,
including old paper-resolution links. New chat starts a fresh conversation;
otherwise Sparky reopens the latest general conversation.

The server saves each question before retrieval or an AI call. Search replies
retain full paper snapshots, interpretation, retrieval time, source provenance,
and coverage warnings in `.scispark/chats/`, not only an expiring feed-cache ID.
Follow-up searches append results without erasing previous turns. Home → Sparky,
reload, and **History → Conversations** restore those snapshots without another
search or AI call. Unsent drafts, mode, Read Sources Only, and temporary source
choices are mirrored in this browser tab's session storage. Newly disabled
sources are still removed from that choice; submitted History is vault-backed. Older lost page-local
search results cannot be reconstructed from query-only logs.

Source settings open over the current conversation. A search can narrow the
enabled indexes for one question. Partial source failures retain usable results
and warnings; all-source failure is reported as unavailable search coverage,
not as evidence that no literature exists. Searches and AI requests use the
existing source pacing, selected BYOK models and usage metering.

Project conversations keep their project identity and fail closed if the project
is deleted. Read Sources Only still restricts answers to saved paper pages.
Saving a transcript does **not** grant future reviews permission to sweep all
previous conversations into personal memory. A restarted/interrupted request is
never replayed merely by reopening its History entry.

## Deep literature review (integrated preview)

Choose **Deep literature review** in Sparky's composer. The question becomes an
inline, editable brief: confirm the scope, selected indexes, personal context,
actual model and estimated allowance, then choose **Start review**. Preparing or
reopening a brief makes no paid call. The question, brief, sources, progress,
reports and revisions remain in conversation History automatically.

The reusable pipeline in `src/lib/review/` combines the licensed TypeScript
adaptation of **ScholarQA's quote → outline → iterative synthesis algorithm**
with SciSpark-owned retrieval, permission checks, durable checkpoints and
per-claim correction/re-audit. It does not install a separate Python research
service or send a vault to an upstream hosted agent. See the pinned source and
license notices in `third_party/`.

1. Plan scholarly queries from the approved question and scope, using only the
   selected, enabled sources. Source adapters retain existing pacing and personal
   API keys. When selected, Semantic Scholar supports modest reference expansion;
   returned references must match the intended DOI/arXiv identifier.
2. Deduplicate and exclude known non-article/retracted records. Read available
   abstracts or identity-checked article HTML. Metadata alone is not evidence.
   Up to four legally obtained PDFs can be attached **before** starting: 5 MB
   each, bounded extraction in a separate process, up to 50 pages / 45,000 text
   characters. Scanned/encrypted PDFs require readable, unlocked text; no OCR or
   paywall bypass is supplied.
3. Assess missing evidence, make one follow-up search round, and reassess coverage.
   Defaults read at most 16 initial papers plus six follow-ups; this is a bounded
   narrative review, not exhaustive systematic-review coverage.
4. Select exact supporting passages, build an excerpt-backed study-comparison
   table, organize themes, and synthesize across papers. Correct and independently
   re-audit each paragraph against its own source passages. Unsupported assertions
   are withheld; missing evidence and unresolved comparisons remain explicit.
5. Produce a separate, tentative **Connections to your research** section using
   the approved context. Memory guides interpretation, not scientific conclusions:
   feed dislikes never suppress contradictory, null or foundational evidence.

Context selection reads relevant profile/interests, canonical preference memories,
selected current-conversation messages, and project-scoped or question-relevant
vault material. It does not sweep historical transcripts. Scientific search and
synthesis do not receive private notes; public DOI/arXiv identifiers from relevant
saved papers can seed retrieval. Changed/revoked context or sources pause new work
until the brief is reviewed. Standalone reports exclude personal interpretation.

The local server owns each run independently of its browser tab. Atomic manifests,
hashed checkpoints, immutable version/source snapshots and filesystem ownership
locks live under `.scispark/reviews/`. Only one deep-review job runs per vault.
Server startup reconciles abandoned runs as **interrupted**, without replaying
paid work. **Resume** requires an explicit action. Cancellation stops future
work; an already-sent provider call may still finish and be charged. Partial
sources and an explicitly unverified working draft remain inspectable.

Every model attempt, including schema-validation retries, reserves an estimated
ceiling before dispatch against the review allowance and daily spending. Reviews
disable hidden provider fallbacks; all skill runs share the spending lock. Prices
are scoped to the chosen provider/model/endpoint. Third-party model endpoints need
explicit token prices; unknown usage is not free. Uncertain responses hold their
reservation and require acknowledgement before replay. These are conservative
estimates, not a provider billing guarantee; pricing overruns pause further work.

The report opens beside the fixed-height conversation (a single panel on mobile).
Citation clicks reveal the exact retained source text and access level. Human edits
and AI wording revisions create new versions with stale-edit protection; changed
claims are labeled as needing checks, not silently certified. Follow-up questions
use a pinned report version and its source excerpts. Markdown/BibTeX export and
**Add to knowledge base** are optional; KB insertion is undoable without removing
the original conversation report. Completion respects Sparky's quiet-notification
rules and is announced at most once per run.

**Acceptance boundary:** this is an integrated preview, not independently validated
scientific review software. Automated passage/claim checks do not prove truth,
complete coverage or publication readiness. Full live pipeline and multi-question
quality acceptance remain separate from passing fixture tests and a production
build. See the [implementation plan](../docs/superpowers/plans/2026-09-07-personalized-literature-review.md),
[original evaluation](../docs/testing/2026-09-07-literature-review-foundation.md), and
[integration verification](../docs/testing/2026-09-07-deep-review-integration.md).

## Sparky's proactive messages

Sparky stays quiet unless a concrete event has a useful next action: a newly
added paper with a live Wiki page, a new review-inbox item, or a recent group
of papers sharing a concept that has not already become an idea. Opening Home
or having a cached feed does not trigger a greeting or a Home reminder.

Before any AI call, the local server atomically records the event identity in
`.scispark/companion-delivery.json`. One server owns each vault; concurrent tabs
share a serialized claim queue. Reloads and server restarts retain suppression.
Dismissed or already claimed events are not repeated; visiting a destination
also consumes its current events without using the interruption budget.
Corrupt/unwritable delivery records fail quiet. This is operational bookkeeping,
not a change to research content or learned preferences.

The default limit is **two proactive messages per rolling 24 hours**, at least
**30 minutes apart**. Settings → Companion offers Off, Low (one/day, 60-minute
gap), Medium (two/day, 30-minute gap), and High (four/day, 15-minute gap).
Messages clear after 60 seconds, on navigation, while typing, when Settings
opens, or when the tab becomes hidden. Onboarding and the unified Sparky workspace
(including `/papers`) remain interruption-free and do not claim proactive events.
Expired events are ignored; a failed/abandoned delivery stays consumed rather
than retrying on every visit. Sparky only suggests actions, never starts them.
User-initiated chats and thumbs-down follow-up questions are separate and are
not limited by this proactive-message budget.

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
[AGENTS.md](../AGENTS.md) and the relevant installed guide under
`node_modules/next/dist/docs/` before changing Next.js code.

## Getting started

Requirements: Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .env.local   # optional public-data credentials
npm run dev
```

Open <http://127.0.0.1:3000>. Connect and test your own AI provider first, then
meet Sparky in a streamed conversation. The connection test checks both the
analysis and quick-steps models (one call if they are the same); storing a key
alone does not mark the connection verified. Your name is the first question. Sparky
interprets free-text research interests, asks about topic variety and remembering
feedback, and clarifies ambiguous preferences. Review and edit the proposed
profile before confirming; only then does the first feed start automatically
with visible progress. Normal use does not require an LLM key in `.env.local`.

Original answers and the proposed interpretation are stored locally in
`profile/onboarding-conversation.json`. Confirmation saves the edited profile
and confirmed answers together in one undoable changeset. Interrupted AI replies
can be retried without submitting the same answer twice. A diversity request
such as “mostly hearing research, with some machine learning” retains its nuance
in feed preferences; Focused / Balanced / Exploratory are approximate selection
policies, not guaranteed numerical quotas. Feedback learning needs an explicit
choice and remains editable in Profile and Settings.

Unknown model pricing is shown as **Cost unavailable**, not zero. Token usage is
still recorded; aggregates containing unpriced calls remain unknown. The local
budget check can enforce only known-price spend, so use your provider's own
spending limits when prices are unavailable. Displayed prices are estimates,
not provider billing records.

For a production-mode local run:

```bash
npm run build
npm run preview
```

Geist, Geist Mono, and Halant are bundled in the repository and served by the
local app. Builds do not download fonts from Google, and browsers make no
external font requests. Font sources, checksums, and redistribution licenses are
documented in [src/assets/fonts/README.md](../src/assets/fonts/README.md).

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

## Choose your Trending fields

In **Settings → Trending fields**, search and select up to three **General
fields** from OpenAlex's official 26-field catalog, then **Save**. For example,
choose Neuroscience and Psychology, with auditory attention as a free-text
**interest** to highlight. General fields work even without narrow interests.
Start at the field level. After choosing a field, optionally expand **Choose
subfields** and select any of its subfields (for example, Neuroscience →
Cognitive Neuroscience and Sensory Systems). No subfields selected means the
**entire field**; selected subfields mean their combined subset, not the parent
plus its children. Each field's panel starts collapsed. Removing a field also
removes its subfield choices. The UI never starts with a flat list of subfields.
Trending uses OpenAlex's taxonomy, not Semantic Scholar's separate categories.
The catalog is bundled for offline selection and was verified against the
[OpenAlex fields endpoint](https://api.openalex.org/fields?per_page=100) on
2026-09-06; source: `src/lib/trending/openalex-fields.ts`.
The companion `openalex-subfields.ts` catalog contains all 252 official
subfields and their parent IDs, verified from the paginated
[OpenAlex subfields endpoint](https://api.openalex.org/subfields?per_page=200&page=1)
on the same date. Subfield labels and parent relationships are not AI-generated.

**Suggest from my interests** performs an explicit OpenAlex lookup, without an
AI call. It previews recognized fields; users must choose **Add** and **Save**.
Suggestions never overwrite selected fields. For existing, unconfigured
automatic settings, a refresh can still derive initial fields from interests.
Saved selections are authoritative. Unknown legacy custom topics stay visible
for replacement and cannot be saved or used as arbitrary retrieval scopes.
The server rejects unknown IDs, duplicates and more than three fields, and
canonicalizes labels from the catalog rather than trusting client labels.
Subfields must belong to the selected parent; invalid or cross-parent IDs are
rejected. Invalid stored subsets require repair, never silently becoming the
whole field.

Every trend metric and paper request uses the same canonical
`primary_topic.field.id` filter and excludes paratext. Topic rows additionally
filter by `primary_topic.id`; neither requires the field's name in paper text.
When narrowed, every request also uses `primary_topic.subfield.id` with an
OR list of selected child IDs. This includes both windows' corpus totals,
topic counts, representative papers, and breakouts. Child selections do not add
extra per-field requests. Cache identity includes both parent and child IDs;
changing a subset cannot reuse metrics for a different scope.
The board compares topic shares between its recent and prior windows.
Breakout papers use the selected fields over a separate 90-day citation window.
These are OpenAlex classification/counting signals, not quality guarantees.

Trending displays explicit comparison dates, labeled publication counts and
share growth. Field buttons filter the cached top-topic selection locally;
they do not change preferences, re-rank papers or trigger another API call.
The list is capped at ten topics across all fields, so a field can be absent
without having no research activity. **Edit fields** opens the saved selection.
Subfields are available in a scope disclosure. Expand a topic for its summary,
dated comparison and paper links. The separate **Highly cited papers** section
retains its all-selected-fields scope and displays its own publication window.

Saving itself makes no AI or research-service calls. Changes apply on the next
refresh; reopening Trending also detects a cached board for different fields.
Cache version 5 invalidates older keyword-scoped metrics while retaining access
to their embedded paper records. Preferences live in local settings, separately
from the recommendation profile, and are excluded from vault exports.

Your explicitly selected fields/subfields also guide **Home Feed** on its next
refresh. Feed reads the same saved selection; there is no second preferences
copy to maintain. These are soft interests for search planning and evidence-based
relevance assessment, not the strict taxonomy filters used by Trending.
With selected subfields, their labels are the interests and the parent is
context. Without subfields, the whole field is an interest. Automatic Trending
derivation alone does not add new explicit Feed interests.
Your profile, saved feedback, enabled paper sources and diversity setting still
apply. Papers without OpenAlex IDs remain eligible, including related work in
other fields. The saved feed records the fields used for that run; saving new
choices does not silently regenerate or rewrite an existing feed.

## Optional public-data credentials

**Settings → Paper sources** also lets users select one or more of arXiv,
OpenAlex, Semantic Scholar, and PubMed, then **Save sources**. All four are
enabled until a selection is saved. The next feed and the Search page use this
selection; Search can narrow it further for a single question. The server
intersects model plans and request scopes with the saved choices, including
feed planning fallbacks. Empty/unknown selections are rejected. No source test
or AI call is made when saving choices, and disabling a source does not remove
its key, existing papers, or the current feed.

This is a Feed/Search preference, not a network firewall: Trending still uses
OpenAlex analytics, and explicit paper resolution, reading, citations and source
connection tests are unchanged. Source choices are local settings in
`paperSources.enabledSources`; the settings file remains excluded from exports.

For Semantic Scholar, open **Settings → Paper sources** (or
`/settings?section=sources`). Paste your personal Semantic Scholar key, choose
**Save & test connection**. This saves the key first, then tests access; a failed
test keeps the key saved. With no replacement entered, the same button becomes
**Test connection** to recheck the saved key without rewriting it.
This is separate from AI BYOK; SciSpark
does not ship a shared source key. Adding it is optional, and other sources
remain usable without it.

The status distinguishes anonymous requests from requests carrying a key. A
saved key is **not** a verified connection: the explicit test sends one fixed
public search (no AI or private research query) through the same paced adapter.
It reports successful access, denied access, rate limiting, or an unavailable
service without returning provider response text. A 429 keeps the key saved and
does not label it invalid. The adapter may make one retry within 20 seconds.

Keys are stored in plaintext in the local vault's server-only
`.scispark/settings.json`, excluded from exports and Changes History, and never
returned by the settings APIs. A saved key takes priority over `S2_API_KEY`;
removing it falls back to that environment variable, or anonymous access when
none is configured. Feed searches, manual searches, citation lookups, and the
connection test all use this resolver. Changes apply to new requests without a
server restart; they do not rewrite an existing feed or its historical warnings.

| Variable | Required? | Purpose |
|---|---|---|
| `SCISPARK_VAULT` | No | Override the default `~/SciSpark/vault` location |
| `OPENALEX_MAILTO` | Recommended | OpenAlex polite-pool contact |
| `OPENALEX_API_KEY` | No | Higher OpenAlex credit allowance |
| `UNPAYWALL_EMAIL` | Required for Unpaywall resolution | Contact required by Unpaywall |
| `S2_API_KEY` | No | Fallback Semantic Scholar key when none is saved in Settings |
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
   active topics, explicitly selected fields/subfields from Trending settings,
   and feed preferences. The selected exploration mode guides how
   narrowly or broadly to search. Planning failure falls back to explicit-topic
   queries on the user's enabled sources with a visible warning.
   The bounded fallback interleaves profile topics with the selected fields'
   labels and rotates enabled sources, so the first topic cannot occupy all
   eight query slots. Field selection adds no extra model call.
2. The live feed calls **enabled arXiv, OpenAlex, Semantic Scholar and PubMed sources as requested**;
   it does not silently relabel one index as another. Queries run concurrently,
   requesting 25 results each with native publication-date filters. Each source
   has a 20-second waiting deadline and visible failure diagnostics. The deadline
   bounds the pipeline's wait; it does not abort an underlying adapter request.
3. The main window starts 14 days before the refresh date. If fewer than ten
   dated candidates remain, retrieval widens once to 90 days. Exact dates are
   checked locally; future/out-of-window papers are excluded. Partial or missing
   dates are labeled unknown, not assigned a fabricated day. A known year outside
   the retrieval years is excluded even if the full date is absent.
4. Source publication types and retraction flags are preserved. Referee reports,
   public peer reviews, supplementary records and other known non-article types
   are excluded before assessment, with a conservative title fallback for older
   records. Legitimate review articles, preprints and conference papers remain
   eligible. Cached feeds receive the same filter when read without rewriting
   the original audit data. Query results are interleaved, shared identifiers are
   merged, and saved or explicitly dismissed papers are excluded. Normalized-title matching is used
   when a DOI is missing, but conflicting DOIs are not merged. After date grouping,
   at most 50 candidates proceed to assessment. This is a bounded discovery feed,
   not an exhaustive systematic-review search.
   Feed does not apply Trending's OpenAlex field/subfield ID filters. Semantic
   paper-text relevance, rather than taxonomy membership, controls eligibility.
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
   Selected fields/subfields are additional declared topic interests. Their
   labels enter the same evidence-checked matches and diversity selection,
   without a separate score bonus or changed weights. They do not invent a
   research question or a method/population requirement. Explicit profile
   constraints remain authoritative; leaving a subfield unchecked is not a
   negative preference. All selected taxonomy leaves remain available even when
   the legacy 20-profile-topic cap is reached. Invalid stored selections are
   skipped with a review warning, never expanded into the whole parent.

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
Sparky asks about exploration and remembering feedback in the onboarding
conversation; there is no separate preferences popup. The confirmation form,
Profile and Settings → Recommendations expose both interpreted settings.
Settings/Profile also offer Reset; changes apply on Save and affect the next
refresh. Disabling learning stops adaptation but does not undo historical
explicit paper dismissals.

- Thumbs up saves a positive paper example. Thumbs down first saves a negative
  example without hiding the paper, then Sparky asks an optional “What missed the mark?”
  question at the bottom right. Options cover topic, method, age, already read,
  and Something else, with an optional 600-character note. Skip keeps the original
  thumbs down without inventing a reason. No LLM call is required for this exchange.
- Votes and reasons leave the current feed unchanged, including after navigation
  or reload. Home and paper detail share persisted, filled thumb states: switching
  thumbs replaces the vote; clicking the selected thumb clears it. No separate
  Feedback menu or success-message clutter is shown. History can undo each
  mutation. Historical explicit dismissals remain respected, but thumbs down
  never hides a paper. Feedback shapes future refreshes, which may select a
  different set of papers.
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
source/query provenance. Those diagnostics remain in the backend record.
Cards instead offer “Why this paper?” in plain language derived from recorded
matches, with title-only versus abstract-based evidence clearly distinguished.
There is **no mandatory second pass generating persuasive
“why this / why you / why now” prose**. Old caches remain readable.

Paper titles lead the cards. Restrained content categories distinguish Methods,
Research findings, Review / synthesis and Data & tools; separate Preprint and
Conference paper labels describe publication status. Labels are based on source
metadata, conservative title cues or explicit abstract self-descriptions—not
claims of “breakthrough” or high impact. Merely using an existing dataset or
citing another review does not change a paper's category.
Save and thumb controls retain their state on Home and paper detail.

Card headers reuse SciSpark's local grain texture over a light category tint,
without a heavy top rule. Texture is decorative and never covers text or controls.

Semantic Scholar and PubMed searches share **per-source HTTP queues** inside the
local server, used by both the direct feed pipeline and the Search API. Request
starts are spaced by at least 1 second for Semantic Scholar and 350 ms for PubMed,
including both ESearch and EFetch. These conservative limits also apply with a
source API key. A 429/503 pauses the source queue using `Retry-After` (5 seconds
when absent/invalid), with only one retry per HTTP request. Each logical search
has a 20-second budget including queueing, retries and response parsing; expiry
cancels queued/active work. Rate limits, access denial and timeouts produce
distinct safe warnings, never URLs or credentials. Previously cached warnings
remain historical until the next feed run.

Home shows the publication window, not the recommendation preference or an
edit-preferences link; these controls remain in Settings → Recommendations.
Past source failures appear in a collapsed, dated “Some searches were incomplete
on the last refresh” notice. It describes search coverage, not live service
availability, and uses source names rather than internal IDs. Assessment and
grounding warnings remain visible because they affect interpretation of results.

Semantic Scholar citation lookups and the connection test also share the search
queue, so they cannot create independent bursts. Pacing cannot guarantee access
to Semantic Scholar's shared unauthenticated pool
or coordinate other programs/server processes on the same IP. Source keys
(`S2_API_KEY`, `NCBI_API_KEY`) are separate from AI BYOK. See the official
[Semantic Scholar usage guidance](https://webflow.semanticscholar.org/product/api/tutorial)
and [NCBI request limits](https://eutilities.github.io/site/API_Key/usageandkey/).

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
See the [design contract](../docs/design/07-recommendation-pipeline.md).

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

See [CLAUDE.md](../CLAUDE.md) for the detailed decision ledger and
[AGENTS.md](../AGENTS.md) for the concise working contract.
