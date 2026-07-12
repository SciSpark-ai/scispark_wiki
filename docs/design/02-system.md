# System Design (Layer 2)

*Status: approved 2026-07-11. The whole-system architecture is "Option 1": local-first browser app + thin stateless server. See [03-backend](03-backend.md) for the server, [04-agent-harness](04-agent-harness.md) for agent internals.*

## Architecture overview

```
┌────────────────────────────  Browser (all user data lives here)  ─────────────────────────┐
│                                                                                            │
│  UI (Next.js app, forked from scispark-app-frontend)                                       │
│   feed · digest · reader · wiki · chat · viz dashboard · review queue · settings           │
│        │                                                                                   │
│  Agent Harness  ──executes──▶  Skills (Feed, Ingest, Reading-Companion, KB-Chat,           │
│        │                        Lint, Memory-Consolidation)                                │
│        │ tools                                                                             │
│  ┌─────┴──────────┐   ┌──────────────┐   ┌─────────────────────────┐                       │
│  │ VaultStorage   │   │ LLMProvider  │   │ proxy API client        │                       │
│  │ OPFS | FSA dir │   │ BYOK, direct │   │ search/resolve/fetch/   │                       │
│  │ (later: sync,  │   │ to provider  │   │ trending                │                       │
│  │  Tauri native) │   └──────┬───────┘   └────────────┬────────────┘                       │
│  └────────────────┘          │                        │                                    │
└──────────────────────────────┼────────────────────────┼────────────────────────────────────┘
                               ▼                        ▼
                    Anthropic/OpenAI/Google/      Vercel: same Next.js deployment
                    OpenRouter (user's key)       (API routes + daily trending cron)
                                                        ▼
                                            arXiv · OpenAlex · Semantic Scholar ·
                                            PubMed · Unpaywall · publisher PDFs
```

Everything personal is client-side. The server relays public data and serves shared trending content. LLM traffic goes directly from the browser to the provider with the user's key.

## The vault

The knowledge base is a **file bundle** (LLM-wiki pattern; mechanism adopted from llm_wiki, taxonomy adapted for research):

```
vault/
  purpose.md          # user's research scope — consulted by every skill
  schema.md           # AUTHORITATIVE page-type → directory routing (user-editable)
  index.md            # app-maintained catalog (never written by the model)
  log.md              # app-maintained chronological operation record
  wiki/
    papers/ concepts/ methods/ findings/ comparisons/ authors/ topics/ notes/ projects/
  sources/            # immutable originals: PDFs, HTML snapshots
  highlights/         # anchored annotations, one file per paper
  .scispark/
    events/           # Tier-1 interaction log (append-only JSONL)
    changesets/       # per-ingest change records for undo
    digests/          # Digest Skill output cache for papers not (yet) ingested;
                      # folded into the paper page at ingest time
    settings.json     # provider keys (local only), tier→model map, budget
```

### Page types (9)

| type | dir | notes |
|---|---|---|
| `paper` | `wiki/papers/` | one per ingested paper; frontmatter carries structured IDs: `doi`, `arxiv`, `openalex`, `authors[]` (IDs), `year`, `venue`, `projects[]`, `full_text` |
| `concept` | `wiki/concepts/` | ideas/phenomena |
| `method` | `wiki/methods/` | techniques/protocols |
| `finding` | `wiki/findings/` | one key result/claim per page — the contradiction-tracking unit |
| `comparison` | `wiki/comparisons/` | X-vs-Y pages; prevents claim-bleed between subjects |
| `author` | `wiki/authors/` | OpenAlex-ID-backed; skeleton created deterministically at ingest |
| `topic` | `wiki/topics/` | living state-of-the-field synthesis; timeline view hangs off these |
| `note` | `wiki/notes/` | user ideas (from highlight-to-ask or manual) |
| `project` | `wiki/projects/` | **virtual index only**: links + optional instructions; scopes agent context; never a physical container |

Frontmatter contract (llm_wiki's, extended): `type`, `title`, `created`, `updated`, `tags[]`, `related[]` (bare slugs), `sources[]` (mandatory provenance). Wikilinks in body only. `schema.md` is injected into ingest prompts as authoritative routing; users may define custom types there.

### Projects

A project is an index page + a context scope, nothing physical. Membership is declared in member pages' frontmatter (`projects: [a, b]`); the project index is derivable and rebuildable from frontmatter. "Chat in project X" = context assembly from the project's linked pages and their neighborhoods. The UI may render projects as a folder tree; the vault layout stays agent-owned.

## Storage abstraction

`VaultStorage` interface: `read/write/list/delete/watch` + changeset primitives. Implementations:
1. **OPFS** (default, all browsers, zero friction) — with `navigator.storage.persist()` requested, and export always available.
2. **File System Access API directory** ("Connect a vault folder", Chromium) — real files the user owns.
3. *(later)* cloud-sync implementation (paid tier); Tauri native FS (desktop app).

Vault zip export/import ships in v1 as the trust escape-hatch and the OPFS↔folder migration path.

## Changesets and undo

Every agent mutation is an atomic changeset: `{id, skill, model, timestamp, files: [{path, before, after}]}` stored under `.scispark/changesets/`. Apply is all-or-nothing after schema validation; revert restores all `before` states. The review queue's actions are themselves changesets. `log.md` records every application in human-readable form.

## Ingest pipeline ("Add to knowledge base")

1. **Acquire full text** — HTML (arXiv/PMC) or PDF via proxy; text extracted client-side. Paywalled → proceed on metadata+abstract+digest, `full_text: false`.
2. **Deterministic pre-fill** — code (not LLM) writes structured frontmatter from API metadata and creates author-page skeletons.
3. **Assemble context** — `purpose.md`, `schema.md`, index, existing digest (reused, not regenerated), the user's highlights/questions on this paper (emphasis signals), target projects.
4. **LLM Step 1: analysis** — entities, concepts, findings + evidence strength, connections to existing wiki, contradictions, recommendations (llm_wiki's prompt near-verbatim).
5. **LLM Step 2: generation** — via **structured output** (`{files[], reviews[]}` JSON schema, not delimiter parsing). Long papers generate in batches to avoid truncation.
6. **Validate + apply** — schema routing check → atomic changeset → app updates `index.md`, `log.md`, project indexes → review items queued → derived views incrementally rebuild.

Failure policy: retry once with the validation error appended; second failure → ingest lands in review queue as a draft (view/edit/retry/discard). Nothing partial is ever written. Expected final-failure rate <1%.

## The feed (agentic RecSys)

Traditional funnel, every learned model replaced by agent reasoning over assembled context. **No trained ML, no collaborative filtering (v1), no third-party embeddings.** If similarity search ever proves necessary: small on-device embedding model only.

1. **Retrieve** — the Feed Skill *formulates search strategies* from user context (like a human assistant) and executes them via proxy API tools: keyword/concept/author searches, citation-graph traversal from recently ingested papers, plus trending-agent candidates.
2. **Rank** — `fast`-tier LLM batch-scores candidates (title+abstract vs. compact context summary), ~500 → ~50.
3. **Re-rank + explain** — `strong`-tier model reads top candidates against full context; final feed with per-card personalized "why this, why you, why now".

Public side: the **trending agent** (server, daily, SciSpark's key) writes per-field trend surveys — the anonymous landing page, a tab for all users, and stage-1 candidate input.

## The user model (two-tier memory)

- **Tier 1 — ground truth:** append-only event log in `.scispark/events/` (views + dwell time, highlights, saves/likes/dismissals, ingests, chat interactions). Local, exported with the vault, replayable.
- **Tier 2 — working memory:** the Memory-Consolidation Skill periodically distills events into **readable, editable wiki pages**: `profile.md` (seeded by onboarding), `interests.md` (evidence-linked, rising/fading), `feedback.md` (standing instructions the user has given agents). Agents consume Tier 2 + recent raw events.
- Editing the pages **is** retraining. Lint watches for drift between tiers; consolidation is always recomputable from Tier 1.

## Review queue

Non-blocking inbox (badge count, no gates). Item types: `contradiction`, `duplicate`, `missing-page`, `suggestion` (llm_wiki's set) + `lint-finding` + `failed-ingest` (ours). Each card offers one-click constrained actions only (e.g. contradiction: keep-both-with-note / prefer-new / prefer-old / discuss-in-chat). Every action is an undoable changeset. The wiki functions indefinitely with items pending.

## Derived views (never stored, always recomputed)

From the bundle: graph (wikilinks ×3.0, shared sources ×4.0, Adamic-Adar ×1.5, type affinity ×1.0 — llm_wiki's weights as starting point; Louvain communities), timeline (papers/findings by date per topic), citation flow (edges from S2/OpenAlex citation links among vault papers), author network (co-authorship among `author` pages). All four are projections over the same derived dataset; adding views later disturbs nothing.
