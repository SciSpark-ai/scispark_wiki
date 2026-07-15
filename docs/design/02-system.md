# System Design (Layer 2)

*Status: approved 2026-07-11; runtime model **superseded 2026-07-14 (M11, "local-runtime pivot")** — implementation-complete on branch `m11-local-runtime`, not yet merged. Tong: "the browser is only for showing UI; runtime is on user." v1 is a **local app**: a Next.js server running on the user's own machine owns the runtime (vault on disk, agent harness, BYOK keys); the browser is UI-only. The Vercel-hosted deployment described in [03-backend](03-backend.md) is now a documented future tier, not the v1 runtime. See `docs/superpowers/specs/2026-07-14-m11-local-runtime-design.md` for the full design, [03-backend](03-backend.md) for the server surface, [04-agent-harness](04-agent-harness.md) for agent internals.*

## Architecture overview

```
┌──────────────────────────────────┐          ┌──────────────────────────────────────────────────────────────┐
│  Browser — UI ONLY                │          │  Local Next.js server (the runtime — runs on the user's own   │
│  (Next.js app, forked from        │  fetch/  │  machine; `npm run dev` / `next start`, localhost)             │
│  scispark-app-frontend)           │  SSE     │                                                                 │
│   feed · digest · reader · wiki · │ ───────▶ │  Vault API        Skills API         Settings API               │
│   chat · viz dashboard · review   │ ◀─────── │  /api/vault/*     /api/skills/*      /api/settings              │
│   queue · settings                │          │  (file/list/       (feed, ingest,     (BYOK keys; GET           │
│                                    │          │   changeset)        ask, chat, spark,  redacts values)          │
│  RemoteVaultStorage implements    │          │       │             trending, …)             │                 │
│  VaultStorage over fetch          │          │       ▼                  │                    │                 │
└──────────────────────────────────┘          │  NodeFsVaultStorage   Agent Harness ──executes──▶ Skills          │
                                                │  (node:fs, vault on   (Feed, Ingest, Reading-Companion,          │
                                                │   disk at SCISPARK_   KB-Chat, Lint, Memory-Consolidation)       │
                                                │   VAULT, default            │ tools                             │
                                                │   ~/SciSpark/vault)   ┌─────┴───────┐   ┌─────────────────────┐ │
                                                │                       │ LLMProvider │   │ local API routes     │ │
                                                │                       │ BYOK, server│   │ search/resolve/fetch/│ │
                                                │                       │ -side key   │   │ trending (same-origin│ │
                                                │                       └──────┬──────┘   │  now, not a CORS     │ │
                                                │                              │           │  relay deployment)   │ │
                                                └──────────────────────────────┼───────────┴──────────┬───────────┘
                                                                               ▼                       ▼
                                                                    Anthropic/OpenAI/Google/   arXiv · OpenAlex ·
                                                                    OpenRouter (user's key)     Semantic Scholar ·
                                                                                                PubMed · Unpaywall ·
                                                                                                publisher PDFs
```

Everything personal lives on the user's own machine — in the local server's process and the vault it owns on disk — not in the browser. The browser only renders UI and talks to the local server's own API routes (`/api/vault/*`, `/api/skills/*`, `/api/settings`); a browser-purity test enforces this boundary (no server-only code, including provider keys, reaches client bundles). The local server also relays public data (the former CORS relay is now just local, same-origin API routes) and holds the BYOK provider key; LLM traffic runs local-server → provider, never browser → provider. A hosted/Vercel deployment of this same app remains a documented future paid tier (see [03-backend](03-backend.md)), not the v1 runtime.

## The vault

The knowledge base is a **file bundle** (LLM-wiki pattern; mechanism adopted from llm_wiki, taxonomy adapted for research):

```
vault/
  purpose.md          # user's research scope — consulted by every skill
  schema.md           # AUTHORITATIVE page-type → directory routing (user-editable)
  index.md            # app-maintained catalog (never written by the model)
  log.md              # app-maintained chronological operation record
  wiki/
    papers/ concepts/ methods/ findings/ comparisons/ authors/ topics/ notes/ ideas/ projects/
  sources/            # immutable originals: PDFs, HTML snapshots
  highlights/         # anchored annotations, one file per paper
  .scispark/
    events/           # Tier-1 interaction log (append-only JSONL)
    changesets/       # per-ingest change records for undo
    digests/          # Digest Skill output cache for papers not (yet) ingested;
                      # folded into the paper page at ingest time
    settings.json     # provider keys (local only), tier→model map, budget
```

### Page types (10)

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
| `idea` | `wiki/ideas/` | Spark Skill output: structured idea cards (bottleneck, mechanism, falsification plan, scoop-check verdict, mini lit-review); frontmatter `status: sparked\|in-progress\|scooped\|abandoned` + links to grounding papers |
| `project` | `wiki/projects/` | **virtual index only**: links + optional instructions; scopes agent context; never a physical container |

Frontmatter contract (llm_wiki's, extended): `type`, `title`, `created`, `updated`, `tags[]`, `related[]` (bare slugs), `sources[]` (mandatory provenance). Wikilinks in body only. `schema.md` is injected into ingest prompts as authoritative routing; users may define custom types there.

### Projects

A project is an index page + a context scope, nothing physical. Membership is declared in member pages' frontmatter (`projects: [a, b]`); the project index is derivable and rebuildable from frontmatter. "Chat in project X" = context assembly from the project's linked pages and their neighborhoods. The UI may render projects as a folder tree; the vault layout stays agent-owned.

## Storage abstraction

`VaultStorage` interface: `read/write/list/delete/watch` + changeset primitives. Implementations (as of the M11 local-runtime pivot, 2026-07-14):
1. **`NodeFsVaultStorage`** (v1, default, server-side) — the vault as plain files on disk via `node:fs/promises`, owned by the local Next.js server. Path from `SCISPARK_VAULT` env var, default `~/SciSpark/vault`; every path resolved and guarded to stay under the vault root; scaffolded (`schema.md`, `purpose.md`, `index.md`, …) on first server start.
2. **`RemoteVaultStorage`** (browser) — implements the same interface over `fetch` against `/api/vault/*`, which proxies to the server's `NodeFsVaultStorage`. Because every page/component already programs against the `VaultStorage` interface, this is a drop-in swap — no page rewrites needed for reads.
3. **`MemoryVaultStorage`** — test double only.
4. *(later)* cloud-sync implementation (paid tier); Tauri wraps the same local server as a packaged desktop app rather than adding a new storage backend.

**Superseded (M11, 2026-07-14):** the original browser-storage model — OPFS (default) and a File System Access API directory connection (Chromium) — is removed from the user path (`OpfsVaultStorage` is unreferenced). The vault is real files on disk in a folder the user owns, not browser-internal storage; there is no OPFS, no File System Access permission dialog, and any browser works.

Vault zip export/import ships in v1 as the trust escape-hatch and backup workflow (the OPFS↔folder migration path no longer applies — there is no OPFS to migrate from).

## Changesets and undo

Every agent mutation is an atomic changeset: `{id, skill, model, timestamp, files: [{path, before, after}]}` stored under `.scispark/changesets/`. Apply is all-or-nothing after schema validation; revert restores all `before` states. As of M11, apply/revert run **server-side** via `POST /api/vault/changeset`, so atomicity/undo never depends on per-file HTTP writes from the browser. The review queue's actions are themselves changesets. `log.md` records every application in human-readable form.

## Ingest pipeline ("Add to knowledge base")

1. **Acquire full text** — HTML (arXiv/PMC) or PDF via proxy; text extracted server-side (the ingest skill runs behind `/api/skills/ingest` on the local server). Paywalled → proceed on metadata+abstract+digest, `full_text: false`.
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
- The three pages live at the vault root alongside `purpose.md`; they are not wiki bundle pages.

## Review queue

Non-blocking inbox (badge count, no gates). Item types: `contradiction`, `duplicate`, `missing-page`, `suggestion` (llm_wiki's set) + `lint-finding` + `failed-ingest` (ours). Each card offers one-click constrained actions only (e.g. contradiction: keep-both-with-note / prefer-new / prefer-old / discuss-in-chat). Every action is an undoable changeset. The wiki functions indefinitely with items pending.

## Derived views (never stored, always recomputed)

From the bundle: graph (wikilinks ×3.0, shared sources ×4.0, Adamic-Adar ×1.5, type affinity ×1.0 — llm_wiki's weights as starting point; Louvain communities), timeline (papers/findings by date per topic), citation flow (edges from S2/OpenAlex citation links among vault papers), author network (co-authorship among `author` pages). All four are projections over the same derived dataset; adding views later disturbs nothing.
