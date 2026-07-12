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
