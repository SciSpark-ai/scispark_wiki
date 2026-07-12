# Agentic AI Harness Design (Layer 4)

*Status: approved 2026-07-11. Organizing principle: **one harness, N skills** — every agent behavior in the product is a versioned skill document executed by the same runtime. (Pattern lineage: research-os `workflows/*.md` playbooks, llm_wiki skills, Claude Code skills.)*

## Skills

A skill is a versioned document + manifest defining: purpose, workflow steps, context-assembly recipe, tool allowlist, model tier per step, output contract (JSON schema where structured), and budget class.

| Skill | Trigger | Steps (tier) | Output |
|---|---|---|---|
| **Research Feed** | daily / app-open / manual refresh | assemble user context → formulate search strategies (strong) → retrieve via API tools → batch rank ~500→50 (fast) → re-rank + per-card explanations (strong) | feed items + "why this, why you, why now" |
| **Trending** | server cron, daily per field | pull 24–48h papers + citation movers → trend survey (strong) | field trend page (JSON+md) |
| **Digest** | first open of a paper | full text/abstract → digest (strong) | summary, lay summary, key methods/results, figure digest |
| **Ingest** | "Add to knowledge base" | deterministic pre-fill (no LLM) → analysis (strong) → generation via structured output (strong) → validate → changeset | wiki changeset + review items |
| **Reading-Companion** | select-text → ask, in reader/digest/wiki | selection + surrounding section + paper page + relevant wiki neighborhood → answer (strong); "capture idea" → note-page changeset proposal | grounded answer / note draft |
| **KB-Chat** | chat UI (global or project-scoped) | retrieve wiki pages (index + links; project scope if set) → answer with page citations (strong) | cited answer |
| **Lint** | manual / weekly | scan bundle: orphans, broken links, stale claims, tier-drift, contradiction candidates (fast; strong for judgment calls) | review-queue items + fix-changeset proposals |
| **Memory-Consolidation** | every N events / nightly | Tier-1 events → update `profile.md`, `interests.md`, `feedback.md` (fast) | changeset to user-model pages |
| **Spark (Quick)** | user prompt / companion offer | vault-only grounding (no retrieval, no scoop-check): cluster/topic + user prompt → 2–3 idea *seeds* with rationale (strong, single call — cents not dollars) | lightweight `idea` stub pages (`status: sparked`, `depth: quick`) |
| **Spark (Deep)** | "develop fully" on a seed / direct request (always user-confirmed with cost estimate — most expensive skill) | ground in vault + fresh retrieval → bottleneck diagnosis (strong) → pattern-guided candidate generation using the 15-pattern/31-sub-pattern cards (strong) → scoop-check: signature-terms (recent window) + alias-terms (long window) collision search over papers APIs → 5-check audit incl. falsification structure; honest `do_not_generate` refusal preserved (strong) → idea card | full `idea` page changeset (card + mini lit-review + scoop verdict; upgrades the seed page when one exists) |
| **Companion** | proactivity-engine triggers | trigger context + user-model pages → one short in-persona utterance + suggested action (fast; template fallback at zero budget) | companion bubble content; deep-links into other skills |

**The companion persona wraps every conversational surface (Tong, 2026-07-11).** Onboarding, KB-Chat, Reading-Companion answers, review-queue discussions, and Spark sessions are all rendered as conversation with the one companion character — one persona definition (shared system-prompt fragment + persona memory), text-only (no audio), skills invisible behind it. Concretely: conversational skills receive the persona fragment in their prompts so tone is consistent, while non-conversational skills (Ingest, Lint, Trending, Memory-Consolidation, Feed ranking) run persona-free — the persona is a rendering concern, never allowed to distort analysis quality.

**Spark Skill lineage:** adapted from MIT-licensed [ResearchStudio-Idea](https://github.com/microsoft/ResearchStudio) (attribution required). We bundle their ideation-pattern cards as skill references and keep their core discipline: locked kill-switch fields (falsification plan), two-channel scoop-check, corpus-anchored audit, isolated per-phase contexts with artifacts on disk (which maps 1:1 onto our changeset model). Our deltas: grounding starts **warm from the user's vault** (their Phase 0 is cold retrieval-only); output is a wiki `idea` page, not a standalone PDF; retrieval uses our proxy APIs (arXiv/OpenAlex/S2/PubMed; OpenReview connector = v1.5 gap for ML-venue coverage). Known caveat: their pattern cards are mined from ICLR/ICML/NeurIPS — excellent for AI/CS ideas, imperfect fit for biomedical; field-specific pattern mining is a v2 opportunity.

**The Companion is not a skill like the others** — it is the *presentation layer* of the whole skill system plus a **proactivity engine**:
- **Triggers are deterministic and free** (no LLM): app-open + fresh feed, digest-open + vault-relevance hit, post-ingest completion, review-queue items pending, idle-in-reader, vault milestones, sparkable-cluster detection (N recent ingests sharing concepts without a linked `idea` page).
- **Utterances are fast-tier** one-liners in persona, generated with trigger context + `feedback.md`; below-budget fallback = static templates.
- **Anti-Clippy contract (harness-enforced):** proactivity budget (max interventions/session, per-trigger cooldowns), chattiness setting, always dismissible, dismissals logged as Tier-1 events → Memory-Consolidation learns what not to suggest. The companion proposes; it never runs vault-mutating or expensive skills without an explicit user click.

The Research Feed Skill is the reference implementation ("Agentic Research Feed Skill") — the standard for how skills encode traditional-workflow structure (RecSys funnel) executed by LLM reasoning. **No trained ML models, no third-party embeddings** anywhere in the system; a small on-device embedding model is the only permitted fallback if agentic retrieval proves insufficient.

## Tool registry (per-skill allowlists)

| Tool | Feed | Trending | Digest | Ingest | Read-Comp | KB-Chat | Lint | Mem-Consol |
|---|---|---|---|---|---|---|---|---|
| `vault.read/search/list` | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `vault.propose_changeset` | – | – | – | ✓ | ✓ (notes only) | – | ✓ | ✓ |
| `papers.search/citations` | ✓ | ✓ | – | – | ✓ | – | – | – |
| `papers.fetch` | – | – | ✓ | ✓ | ✓ | – | – | – |
| `trending.get` | ✓ | – | – | – | – | – | – | – |
| `events.query` | ✓ | – | – | – | – | – | – | ✓ |
| `user.flag` (→ review queue) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Additions for the two new skills: **Spark** gets `vault.read/search/list`, `papers.search/citations`, `vault.propose_changeset` (idea pages), `user.flag`. **Companion** gets `vault.read/search/list`, `events.query`, `trending.get`, `user.flag` — read-only + flagging; it deep-links to other skills rather than invoking them itself.

## Safety contract (harness-enforced, never prompt-trusted)

1. **No raw writes.** The only mutation path is `vault.propose_changeset`: schema-validated, atomic, logged, undoable. Worst case = a bad proposal, which is revertable.
2. **No open network.** Skills reach registered tools only; there is no arbitrary-URL tool in v1. Deep research/web search is v1.5 and goes through the proxy allowlist when it arrives.
3. **Paper text is untrusted input.** Agents read documents from the open internet; a malicious document may embed instructions. The defense is rules 1+2 (nothing to exfiltrate with; writes constrained + reviewable + undoable), with source text framed as quoted data in prompts as hygiene, not as the guarantee.
4. **Mandatory provenance.** Every changeset records skill, model, and sources (`log.md` + frontmatter `sources[]`).

## LLMProvider

Interface: `complete(messages, {tier, schema?, stream?}) → text | validated JSON`, plus token-usage reporting. v1 implementations: **Anthropic, OpenAI, Google, OpenRouter** (all support browser BYOK). Keys live in local settings only. Structured output uses each provider's native JSON-schema/tool-call mechanism; the harness validates and retries once with the error on mismatch. Ollama/local: v1.5.

## Model tiers

Skills declare `fast` or `strong` per step — never model names. Settings map tiers → concrete models per provider, with maintained defaults (e.g., current Haiku-class for `fast`, Sonnet/GPT-equivalent for `strong`). Users can override.

## Budget & metering

- The harness meters every provider call: tokens in/out → estimated cost, attributed to skill + run, persisted locally.
- UI: an "AI spend" panel (today / this month / by skill) — BYOK users see exactly where money goes.
- **User-set daily budget** (default: a few dollars), enforced by the harness: when a run would exceed it, degrade gracefully — Feed falls back to fewer candidates or cached trending with a "refresh manually to spend more" affordance; background skills (lint, consolidation) defer; user-initiated actions (ingest, chat) warn and ask.
- Order-of-magnitude at defaults: feed run $0.05–0.20, ingest $0.10–0.30, chat pennies/message.

## Execution semantics

- Skill runs are resumable jobs with persisted state (a browser tab can close mid-ingest; the run resumes or safely discards — nothing partial ever reaches the vault thanks to atomic changesets).
- Retry policy: transient provider errors retry with backoff; validation failures retry once with the error appended; then park in the review queue (`failed-ingest` draft) rather than fail silently.
- Concurrency: one vault-mutating skill run at a time (changeset serialization); read-only skills run freely.
- The Trending Skill runs the same harness code server-side on the cron — one harness implementation, two homes.
