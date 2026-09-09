# Agentic AI Harness Design (Layer 4)

*Status: approved 2026-07-11; runtime model **superseded 2026-07-14 (M11, "local-runtime pivot")** — skills now execute server-side, in `/api/skills/*` route handlers via `getServerVault()`/`NodeFsVaultStorage`, not in the browser. M12 (2026-07-14) adds the **Lint** skill (deterministic checks + a two-stage `fast`-screen/`strong`-judge LLM pass) and makes the usage-metering ledger visible through a spend surface. See `docs/superpowers/specs/2026-07-14-m11-local-runtime-design.md` and `docs/superpowers/specs/2026-07-14-m12-lint-spend-hardening-design.md` for the full pivots, and [02-system](02-system.md)/[03-backend](03-backend.md) for the server surface this doc assumes. Organizing principle: **one harness, N skills** — every agent behavior in the product is a versioned skill document executed by the same runtime (now server-side). (Pattern lineage: research-os `workflows/*.md` playbooks, llm_wiki skills, Claude Code skills.)*

## September 7, 2026: durable quick-search conversations

The unified Sparky workspace uses `askChat` for both saved-research discussion
and quick online paper search. The orchestrator persists the user message before
any paid work, serializes turns per session in the local process, and records
typed paper-result/citation blocks alongside legacy text turns. A supplied
operation ID is idempotent within that session; different questions/options
cannot reuse it. Interrupted requests are not silently replayed. Paper snapshots
survive feed-cache expiry and History reopening. The legacy research-search API
also records its result in conversation History.

The quick search still reuses its bounded planner/ranker and registered source
adapters. Source failures propagate as coverage warnings or an all-source error.
Neither page navigation nor History reopening invokes those skills again.
Project search planning uses project title/instructions and that conversation;
it does not forward unrelated private library context. This is not the narrower,
query-specific personal-memory selector implemented for deep reviews.

`src/lib/review/scholarqa.ts` is the **integrated-preview academic adapter**, adapted from
Ai2 ScholarQA's Apache-2.0 multi-step pipeline at the revision in its notice.
Every completion is host-injected. Exact quotations, outline indices and
section citation IDs are checked, but those checks alone do not verify support.
`grounding.ts` adds a host-injected correction stage: rewrite every paragraph into
claim/passage mappings, lint exact quotations/numbers/significance/uncertainty,
then audit each claim against its mapped evidence and surrounding source text.
An omitted supported finding also triggers correction. There are at most two
correction attempts per paragraph; remaining failures keep `needs-review` status
and cannot render as a checked draft. Evidence gaps are disclosed as open
questions, not invented answers or failed claims. Audit signatures bind the
claims to their source snapshots; later claim/source edits invalidate them.
These are conservative automated checks, not independent scientific validation.
The normal evaluation path runs correction after its coarse audit, and cache-only
replay can reconstruct a checked draft without additional paid calls.
`coordinator.ts` now owns execution independently of request/tab lifetime, with
atomic manifests/checkpoints, cross-process local-filesystem locks, one active
research job per vault and explicit restart recovery. `budget.ts` reserves every
completion before dispatch, shares the AI-spend exclusion with ordinary skills,
persists response/usage before replay and holds uncertain charges. Reviews forbid
unreserved provider-internal fallback attempts. An estimate is not guaranteed billing.

`pipeline.ts` uses the selected existing academic adapters and safe acquisition,
coverage-guided follow-up retrieval, study comparison, synthesis and grounding.
`context.ts` selects relevant canonical profile/preferences/project material and
current-conversation turns without searching old transcripts. Notes are not source
evidence; personal interpretation is a separate section. `pdf.ts` runs bounded
pdf.js extraction in a child process without provider credentials.

`/api/reviews/*` exposes approval, snapshots, cancel/resume, versioned edits,
revision, exports and PDF input. Conversations retain report links automatically;
KB insertion is a separate undoable mutation. No implicit user-memory writes occur.
See the [plan](../superpowers/plans/2026-09-07-personalized-literature-review.md),
[historical feasibility record](../testing/2026-09-07-literature-review-foundation.md)
and [current verification](../testing/2026-09-07-deep-review-integration.md).

## Skills

A skill is a versioned document + manifest defining: purpose, workflow steps, context-assembly recipe, tool allowlist, model tier per step, output contract (JSON schema where structured), and budget class.

| Skill | Trigger | Steps (tier) | Output |
|---|---|---|---|
| **Research Feed** | daily / app-open / manual refresh | assemble user context → formulate search strategies (strong) → retrieve via API tools → batch rank ~500→50 (fast) → re-rank + per-card explanations (strong) | feed items + "why this, why you, why now" |
| **Trending** ("Academia Right Now", SP4) | staleness-scheduled (cadence in settings; default weekly; manual refresh), scoped to the user's broad **anchor disciplines** — the refresh runs server-side behind `POST /api/skills/trending/refresh` | per anchor: one `group_by=primary_topic.id` over the recent window + two corpus counts (recent/prior) + one topic-scoped prior count per candidate → rank by growth in SHARE of the discipline corpus (deterministic, never LLM-emitted) → representative + breakout papers → per-topic qualitative briefs (strong, persona-free), joined back by key verbatim | one `TrendingBoard`: ranked topic rows (share growth, prior→recent bars, absolute counts, "relevant to you" lens flag, LLM "why"), an overview strip and a breakout-papers strip; `surveyError`/`dataError` carry any layer's real failure reason |
| **Digest** | first open of a paper | full text/abstract → digest (strong) | summary, lay summary, key methods/results, figure digest |
| **Ingest** | "Add to knowledge base" | deterministic pre-fill (no LLM) → analysis (strong) → generation via structured output (strong) → validate → changeset | wiki changeset + review items |
| **Reading-Companion** | select-text → ask, in reader/digest/wiki | selection + surrounding section + paper page + relevant wiki neighborhood → answer (strong); "capture idea" → note-page changeset proposal | grounded answer / note draft |
| **KB-Chat** | chat UI (global or project-scoped) | retrieve wiki pages (index + links; project scope if set) → answer with page citations (strong) | cited answer |
| **Lint** | manual only (v1 — no auto-schedule) | **deterministic** (free, instant, pure functions over the loaded bundle, `src/lib/lint/checks.ts`): `orphan` / `broken-link` / `bad-frontmatter` / `index-drift` → **LLM** (manual, cost shown up front before running): `fast`-tier screen proposes candidate page pairs from `related[]` + shared-source adjacency, then `strong`-tier judges only the flagged pairs for `contradiction` / `stale-claim` | review-queue `lint-finding` items (6 subtypes, `src/lib/wiki/review-queue.ts`); `broken-link`/`bad-frontmatter`/`index-drift` carry an undoable one-click fix changeset, `orphan`/`contradiction`/`stale-claim` are advisory (no auto-fix) |
| **Memory-Consolidation** | every N events / nightly | Tier-1 events → update `profile.md`, `interests.md`, `feedback.md` (fast) | changeset to user-model pages |
| **Spark (Quick)** | user prompt / companion offer | vault-only grounding (no retrieval, no scoop-check): cluster/topic + user prompt → 2–3 idea *seeds* with rationale (strong, single call — cents not dollars) | lightweight `idea` stub pages (`status: sparked`, `depth: quick`) |
| **Spark (Deep)** | "develop fully" on a seed / direct request (always user-confirmed with cost estimate — most expensive skill) | ground in vault + fresh retrieval → bottleneck diagnosis (strong) → pattern-guided candidate generation using the 15-pattern/31-sub-pattern cards (strong) → scoop-check: signature-terms (recent window) + alias-terms (long window) collision search over papers APIs → 5-check audit incl. falsification structure; honest `do_not_generate` refusal preserved (strong) → idea card | full `idea` page changeset (card + mini lit-review + scoop verdict; upgrades the seed page when one exists) |
| **Companion** | proactivity-engine triggers | trigger context + user-model pages → one short in-persona utterance + suggested action (fast; template fallback at zero budget) | companion bubble content; deep-links into other skills |
| **Search-Intent** | `/papers` search submit (before the search fires; post-M12 followup, 2026-07-15) | typed query (fenced as untrusted) → classify relevance- vs recency-intent (fast, persona-free) | `{sort: "relevance" \| "date"}` — threaded to `/api/search?sort=`, so the adapters rank by extracted intent instead of a hardcoded policy; degrades to `relevance` on any failure |

**The companion persona wraps every conversational surface (Tong, 2026-07-11).** Onboarding, KB-Chat, Reading-Companion answers, review-queue discussions, and Spark sessions are all rendered as conversation with the one companion character — one persona definition (shared system-prompt fragment + persona memory), text-only (no audio), skills invisible behind it. Concretely: conversational skills receive the persona fragment in their prompts so tone is consistent, while non-conversational skills (Ingest, Lint, Trending, Memory-Consolidation, Feed ranking, Search-Intent) run persona-free — the persona is a rendering concern, never allowed to distort analysis quality.

**Spark Skill lineage:** adapted from MIT-licensed [ResearchStudio-Idea](https://github.com/microsoft/ResearchStudio) (attribution required). We bundle their ideation-pattern cards as skill references and keep their core discipline: locked kill-switch fields (falsification plan), two-channel scoop-check, corpus-anchored audit, isolated per-phase contexts with artifacts on disk (which maps 1:1 onto our changeset model). Our deltas: grounding starts **warm from the user's vault** (their Phase 0 is cold retrieval-only); output is a wiki `idea` page, not a standalone PDF; retrieval uses our proxy APIs (arXiv/OpenAlex/S2/PubMed; OpenReview connector = v1.5 gap for ML-venue coverage). Known caveat: their pattern cards are mined from ICLR/ICML/NeurIPS — excellent for AI/CS ideas, imperfect fit for biomedical; field-specific pattern mining is a v2 opportunity.

**The Companion is not a skill like the others** — it is the *presentation layer* of the whole skill system plus a **proactivity engine**:
- **Triggers are deterministic and free** (no LLM): app-open + fresh feed, digest-open + vault-relevance hit, post-ingest completion, review-queue items pending, idle-in-reader, vault milestones, sparkable-cluster detection (N recent ingests sharing concepts without a linked `idea` page).
- **Utterances are fast-tier** one-liners in persona, generated with trigger context + `feedback.md`; below-budget fallback = static templates.
- **Anti-Clippy contract (harness-enforced):** only concrete, new events with live action destinations qualify. No app-open/Home greeting. Before AI generation, a server-owned per-vault ledger atomically claims each event and enforces a rolling 24-hour budget plus cooldowns across tabs/reloads/restarts (default: two messages, 30 minutes apart). Viewed destinations consume their events without interrupting. Claimed events are not retried after dismissal or delivery failure; stale events and corrupt bookkeeping fail quiet. Bubbles expire after 60 seconds and clear on navigation, Settings, typing or hidden tabs. User-initiated feedback questions bypass this proactive budget. Dismissals/actions remain Tier-1 audit events. The companion proposes; it never runs vault-mutating or expensive skills without an explicit user click.

The Research Feed Skill is the reference implementation ("Agentic Research Feed Skill") — the standard for how skills encode traditional-workflow structure (RecSys funnel) executed by LLM reasoning. **No trained ML models, no third-party embeddings** anywhere in the system; a small on-device embedding model is the only permitted fallback if agentic retrieval proves insufficient.

**Blessed pattern (M5): skills are pure LLM-calling units. Storage access belongs to orchestrator functions (`generateDigest`, `runIngest`, `runFeed`, `runConsolidation`). A skill may carry storage in its input only when it must read/write mid-run (Ingest is the one current case), and that access must be declared in the skill's tool manifest.** As of M11, these orchestrator functions execute inside `/api/skills/*` route handlers on the local server (via `getServerVault()`), never in the browser; the orchestrator/skill split itself is unchanged — the pivot moved *where* orchestrators run, not *what* they are (see "Runtime & execution location" below). The same pattern extends to Lint (M12): `runLintDeterministic`/`runLintLlm` (`src/lib/lint/run.ts`) are the orchestrators; `lintScreenSkill`/`lintJudgeSkill` (`src/lib/skills/lint.ts`) are the pure LLM-calling units.

## Runtime & execution location (M11, 2026-07-14)

**Superseded:** the original design had the harness executing in the browser — skills called directly from client code, tools resolving against browser-held storage and BYOK keys. As of the M11 local-runtime pivot, **skills execute server-side**, in Next.js route handlers under `/api/skills/*` (one route per surface: feed refresh, digest, ingest, ask, chat, spark quick/deep/estimate, trending refresh, companion utterance, consolidate, and — new in M12 — lint). Each handler:

1. resolves `getServerVault()` (a `NodeFsVaultStorage` singleton over the vault on disk) and server-side settings (`loadSettings`) — never client-supplied;
2. invokes the existing orchestrator function unchanged (`runFeed`, `runIngest`, `runDeepSpark`, `runLintDeterministic`/`runLintLlm`, …) — the orchestrators were already runtime-portable (every live gate already ran them in Node), so the pivot moved *where* they run, not *what* they are;
3. returns either a single JSON payload for short runs (`jsonSkillRoute`) or a newline-delimited JSON (NDJSON) stream for long runs (`ndjsonSkillRoute`) — one `{"type":"progress",...}` line per unit of work, terminating in `{"type":"result","payload":...}` or `{"type":"error","message":...}` (`src/lib/server/skill-route.ts` + `src/lib/server/ndjson.ts`).

The browser never holds a provider key, never runs an orchestrator, and never resolves a tool directly — it calls a skill route over `fetch` (parsing NDJSON client-side via the shared `readNdjson` helper) and renders the result. A browser-purity test (`src/lib/__tests__/browser-purity.test.ts`) enforces the boundary: no server-only module (BYOK keys, `node:fs`, orchestrators) may reach a client bundle. See [02-system](02-system.md) for the request-path diagram and [03-backend](03-backend.md) for the full `/api/skills/*` route table.

## Tool registry (per-skill allowlists)

| Tool | Feed | Trending | Digest | Ingest | Read-Comp | KB-Chat | Lint | Mem-Consol |
|---|---|---|---|---|---|---|---|---|
| `vault.read/search/list` | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `vault.propose_changeset` | – | – | – | ✓ | ✓ (notes only) | – | ✓ | ✓ |
| `papers.search/citations` | ✓ | ✓ | – | – | ✓ | – | – | – |
| `papers.fetch` | – | – | ✓ | ✓ | ✓ | – | – | – |
| `trending.get` *(deferred, v2)* | ✓ | – | – | – | – | – | – | – |
| `events.query` | ✓ | – | – | – | – | – | – | ✓ |
| `user.flag` (→ review queue) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Additions for the two new skills: **Spark** gets `vault.read/search/list`, `papers.search/citations`, `vault.propose_changeset` (idea pages), `user.flag`. **Companion** gets `vault.read/search/list`, `events.query`, `trending.get`, `user.flag` — read-only + flagging; it deep-links to other skills rather than invoking them itself.

**`trending.get` / Feed integration deferred (reframed 2026-07-14):** the `trending.get` tool and feeding trending output into the Feed Skill's stage-1 candidates are **not built in v1**. M10 shipped a personalized, self-contained `/trending` dashboard (own retrieval, own cache at `.scispark/trending/dashboard.json`); wiring its output back into Feed candidates is a noted, deferred follow-up (see `docs/superpowers/specs/2026-07-14-m10-trending-dashboard-design.md`, "Out of scope (v1)").

## Safety contract (harness-enforced, never prompt-trusted)

1. **No raw writes.** The only mutation path is `vault.propose_changeset`: schema-validated, atomic, logged, undoable. Worst case = a bad proposal, which is revertable.
2. **No open network.** Skills reach registered tools only; there is no arbitrary-URL tool in v1. Deep research/web search is v1.5 and goes through the proxy allowlist when it arrives.
3. **Paper text is untrusted input.** Agents read documents from the open internet; a malicious document may embed instructions. The defense is rules 1+2 (nothing to exfiltrate with; writes constrained + reviewable + undoable), with source text framed as quoted data in prompts as hygiene, not as the guarantee.
4. **Mandatory provenance.** Every changeset records skill, model, and sources (`log.md` + frontmatter `sources[]`).

## LLMProvider

Interface: `complete(messages, {tier, schema?, stream?}) → text | validated JSON`, plus token-usage reporting. v1 implementations: **Anthropic, OpenAI, Google, OpenRouter** (all BYOK). Keys live in `vault/.scispark/settings.json` and are read/used only by the local server (`buildProvider` runs server-side, M11) — never in a browser bundle; `GET /api/settings` returns presence flags only, never key values. Structured output uses each provider's native JSON-schema/tool-call mechanism; the harness validates and retries once with the error on mismatch. Ollama/local: v1.5.

## Model tiers

Skills declare `fast` or `strong` per step — never model names. Settings map tiers → concrete models per provider, with maintained defaults (e.g., current Haiku-class for `fast`, Sonnet/GPT-equivalent for `strong`). Users can override.

## Budget & metering

- The harness meters every provider call: tokens in/out → estimated cost, attributed to skill + run, persisted locally.
- UI: an "AI spend" panel (today / this month / by skill) — BYOK users see exactly where money goes.
- **User-set daily budget** (default: a few dollars), enforced by the harness: when a run would exceed it, degrade gracefully — Feed falls back to fewer candidates or cached trending with a "refresh manually to spend more" affordance; background skills (lint, consolidation) defer; user-initiated actions (ingest, chat) warn and ask.
- Order-of-magnitude at defaults: feed run $0.05–0.20, ingest $0.10–0.30, chat pennies/message.
- **Usage ledger + spend surface (M12).** Every metered call already appends a `UsageRecord` (`{ts, skill, model, usage, costUsd}`) to `.scispark/usage/YYYY-MM-DD.jsonl` (`src/lib/llm/metering.ts`). `GET /api/usage` (server-side, via `getServerVault()`) reads the last 7 UTC days and aggregates them with the pure `summarizeUsage()` (`src/lib/llm/usage-summary.ts`) into `{today: {totalUsd, bySkill}, days: [...], budgetUsd}`; unpriced models (`costUsd: null`) count as 0 and are surfaced as an "unpriced" note rather than dropped. The ledger carries no key material, so the route needs no redaction. `PUT /api/settings` edits `dailyBudgetUsd` from the same panel. See [05-frontend](05-frontend.md) for the spend-panel UI this feeds.

## Execution semantics

- Skill runs execute inside a server route handler (`/api/skills/*`) on the user's local Next.js server, not in the browser (M11). A browser tab closing drops the in-flight `fetch`/NDJSON connection client-side, but changeset atomicity is unaffected either way — nothing partial ever reaches the vault, because changeset application happens inside the handler, server-side, before the response completes.
- Retry policy: transient provider errors retry with backoff; validation failures retry once with the error appended; then park in the review queue (`failed-ingest` draft) rather than fail silently.
- Concurrency: one vault-mutating skill run at a time (changeset serialization), enforced by a per-storage guard now keyed on the server's singleton `NodeFsVaultStorage` (M11) — this serializes across browser tabs too, not just within one tab; read-only skills run freely.
- The Trending Skill's refresh runs **server-side** behind `POST /api/skills/trending/refresh` (M11), invoked by a staleness check the client performs (cache `generatedAt` vs. a cadence setting) on `/trending` load or app-open, plus a manual Refresh button — not an independent server cron. v1 still has one home (the user's own local server), and only while it's running. A server-side cron re-running the same harness code on SciSpark's own key (per the originally-planned public-trending model) remains a documented **v2** growth path, not built in v1.
- The Lint Skill is manual-trigger only in v1 (no auto-schedule, M12): a "Lint vault" control runs the deterministic pass instantly; a "Run deep lint" control runs the LLM pass behind a cost estimate/confirm (`POST /api/skills/lint/estimate` → `window.confirm`), the same idiom as Deep Spark.
