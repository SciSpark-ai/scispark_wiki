# Frontend Design (Layer 5)

*Status: approved 2026-07-11; runtime model **superseded 2026-07-14 (M11, "local-runtime pivot")** — the frontend is now strictly **UI-only**. It reads/writes the vault through `RemoteVaultStorage` (`fetch` against `/api/vault/*`), runs every agent skill by calling `/api/skills/*` (NDJSON-streamed for long runs, plain JSON for short ones), and reads/writes provider keys and budget through `/api/settings` (GET redacts key values to presence flags) and spend data through `/api/usage`. It never runs an orchestrator, resolves a tool, or holds a provider key — that boundary is enforced by a browser-purity test (`src/lib/__tests__/browser-purity.test.ts`), not just convention. M12 (2026-07-14) adds the Lint UI (inbox `lint-finding` cards + "Lint vault"/"Run deep lint" controls) and the spend panel. See `docs/superpowers/specs/2026-07-14-m11-local-runtime-design.md` and `docs/superpowers/specs/2026-07-14-m12-lint-spend-hardening-design.md`, and [02-system](02-system.md)/[03-backend](03-backend.md)/[04-agent-harness](04-agent-harness.md) for the server side of every call this doc describes. Deliberately the lightest design layer: we fork the existing prototype, and the UI is expected to evolve once the product solidifies. This doc records the reuse strategy and the three component commitments.*

## Reuse strategy

Fork `/Users/tongshan/Documents/scispark-app-frontend` into this repo as the starting codebase (Next.js 16 App Router, React 19, Tailwind v4, Zustand 5, framer-motion 12).

**Keep (architecture + patterns):** AppShell 3-column layout (sidebar / main / right panel), feed cards + tabs, paper digest page layout, chat UI (streaming, clickable `[N]` citations, sources panel, reasoning trace), highlight-selection bubble, projects UI shell, library, onboarding-chat pattern, page transitions, the design system (warm cream/espresso palette, orange accent, Halant/Geist, 28px radii, grain).

**Strip (clinical content):** mock papers/chats/projects, medical specialty taxonomy + colors, clinical onboarding questions, clinical copy (taglines, chips, reasoning-step strings).

**Rewire:** mock hooks are replaced by real services *behind the same interfaces* — `useFeed` → Feed Skill runs; `useChat` → KB-Chat Skill with real streaming; digest fields → Digest Skill output; paper actions/notes stores → vault-backed. Zustand stays for UI state; **vault becomes the source of truth for knowledge data** (stores become caches over `VaultStorage`, replacing localStorage persistence). As of M11, "vault-backed" concretely means `VaultStorage` calls resolve to `RemoteVaultStorage`, which proxies over `fetch` to `/api/vault/*` on the local server — every page/component already programs against the `VaultStorage` interface, so this swap needed no page rewrites for reads. "Feed Skill runs" / "KB-Chat Skill" now mean a `fetch`/NDJSON call to `/api/skills/feed/refresh` / `/api/skills/chat`; the orchestrator and skill code itself runs on the local server, never in the client bundle.

Note when editing the fork: its `CLAUDE.md`/`AGENTS.md` warn that Next.js 16 has post-training-data breaking changes — read the bundled docs before nontrivial framework work.

## Screens (v1)

| Screen | Source | Notes |
|---|---|---|
| Trending | new | as of the M10 reframe, a **personalized** dashboard (not a public/anonymous landing page); as of SP4 it is "Academia Right Now": a leaderboard of topics ranked by growth in share of their discipline's corpus, **scoped by broad anchor disciplines** (derived from the user's interests, editable in Settings), with the user's narrow interest labels acting as a **relevance lens** ("relevant to you" markers) rather than the retrieval scope; refresh runs server-side behind `/api/skills/trending/refresh` (M11) on the user's own key; the originally-planned public/anonymous cron-fed `/api/trending/{field}` model remains a documented v2 growth path (see [03-backend](03-backend.md)) |
| Onboarding | adapt existing onboarding-chat | general-research questions; creates local profile; optional email registration at final step |
| Home / For-You feed | adapt | agentic feed with per-card "why" explanations; Trending as sibling tab |
| Paper digest | adapt | real Digest Skill output; "Add to knowledge base" button + ingest progress |
| **Reader** | **new** | HTML full text or pdf.js; persistent highlights; select → ask/capture |
| Wiki page view/edit | new | Milkdown WYSIWYG; wikilink navigation; frontmatter panel; backlinks |
| Wiki browser | new | type-directory tree + index; project tree (virtual) |
| Viz dashboard | new | four views: graph, timeline, citation flow, author network |
| Chat | adapt | global or project-scoped; citations open vault pages |
| Review queue | new | inbox cards with constrained one-click actions; as of M12, `/wiki/inbox` also carries a "Lint vault" button (instant deterministic pass: orphan/broken-link/bad-frontmatter/index-drift) and a "Run deep lint (~$X)" button (cost-estimate → confirm → LLM pass for contradiction/stale-claim, NDJSON pair-by-pair progress); findings render as `lint-finding` cards, with a one-click fix affordance for the three mechanical checks |
| Library | adapt | saved/liked/read-later from vault data |
| Settings | new | providers/keys and tier→model map via `/api/settings` (GET redacts key values to presence flags; keys never round-trip back to the browser); budget editor + AI spend panel (implemented as of M12 at `/debug/llm` — `SpendPanel`: today-vs-budget bar, 7-day chart, per-skill breakdown, reading `GET /api/usage`); vault management — as of M11 the vault path is `SCISPARK_VAULT` on the local server, not a browser folder connection (no File System Access API/OPFS picker in v1); export/import zip exists as a library-level backup path (`exportVaultZip`/`importVaultZip`, round-trip-tested M12) with no dedicated UI yet; companion chattiness |
| **Companion** | **new** | persistent small mascot (corner of the shell, all screens); text-only speech bubbles with action buttons + dismiss (no audio); subtle idle/celebration animations (framer-motion). **All chat surfaces in the app render as conversation with the companion** — onboarding, KB chat, select-to-ask, review discussions, spark sessions share one persona, one visual chat identity (the existing chat UI is re-skinned as companion conversation) |
| Spark | new | "Spark ideas" entry (global + per-project/topic); **Quick Spark** = inline companion conversation returning 2–3 seeds with "develop fully" buttons; **Deep Spark** = confirmation with cost estimate → run progress view (phases visible — grounding → bottleneck → ideation → scoop-check → card); idea cards gallery reading from `wiki/ideas/`; idea page view with status, depth, grounding links, scoop verdict, mini lit-review |

## Component commitments

- **Wiki editor: Milkdown** (ProseMirror-based WYSIWYG markdown). llm_wiki-proven — crib their integration for wikilink rendering/completion and frontmatter handling. "SciSpark owns the renderer" means this editor is ours to polish.
- **Graph: Sigma.js + graphology.** WebGL scaling to thousands of nodes; graphology supplies Louvain communities and Adamic-Adar for the borrowed relevance model. Node color by type/community, edge weight by relevance, hover-neighborhood, click → wiki page.
- **Reader: pdf.js** text layer + our highlight overlay. Highlight anchors = quoted text + position hints (robust to re-render; survives minor text-layer differences). HTML full texts (arXiv/PMC) render natively with the same selection/highlight machinery.
- Timeline / citation flow / author network: custom D3 over the derived dataset — no additional heavy library.
- **All four viz derivations run client-side by design (M11), not as a skill/route.** The bundle itself is fetched over `RemoteVaultStorage`, but graph construction/Louvain/Adamic-Adar and the D3 layouts stay in the browser — they are rendering-adjacent compute that has to live in the page for Sigma/SVG anyway, so the "browser is UI-only" rule doesn't pull them server-side.

## Selection → AI interaction (the signature interaction)

One mechanism everywhere (reader, digest, wiki pages): select text → floating bubble with **Ask** (Reading-Companion Skill: answer grounded in the selection + paper + wiki neighborhood, in the right panel — a `fetch` call to `POST /api/skills/ask` since M11, the skill itself running server-side) / **Highlight** (persist to `highlights/` via `RemoteVaultStorage`) / **Capture idea** (draft a `note` page linked to the source, applied as a server-side changeset via `POST /api/vault/changeset`). All three log Tier-1 events that feed personalization.

## Non-goals for v1 UI

No visual redesign (design system carries over), no mobile layouts beyond what the fork already handles, no theming/dark mode, no collaborative cursors. The UI earns a real design pass after the product is validated (per Tong's layer ordering).
