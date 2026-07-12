# Frontend Design (Layer 5)

*Status: approved 2026-07-11. Deliberately the lightest design layer: we fork the existing prototype, and the UI is expected to evolve once the product solidifies. This doc records the reuse strategy and the three component commitments.*

## Reuse strategy

Fork `/Users/tongshan/Documents/scispark-app-frontend` into this repo as the starting codebase (Next.js 16 App Router, React 19, Tailwind v4, Zustand 5, framer-motion 12).

**Keep (architecture + patterns):** AppShell 3-column layout (sidebar / main / right panel), feed cards + tabs, paper digest page layout, chat UI (streaming, clickable `[N]` citations, sources panel, reasoning trace), highlight-selection bubble, projects UI shell, library, onboarding-chat pattern, page transitions, the design system (warm cream/espresso palette, orange accent, Halant/Geist, 28px radii, grain).

**Strip (clinical content):** mock papers/chats/projects, medical specialty taxonomy + colors, clinical onboarding questions, clinical copy (taglines, chips, reasoning-step strings).

**Rewire:** mock hooks are replaced by real services *behind the same interfaces* — `useFeed` → Feed Skill runs; `useChat` → KB-Chat Skill with real streaming; digest fields → Digest Skill output; paper actions/notes stores → vault-backed. Zustand stays for UI state; **vault becomes the source of truth for knowledge data** (stores become caches over `VaultStorage`, replacing localStorage persistence).

Note when editing the fork: its `CLAUDE.md`/`AGENTS.md` warn that Next.js 16 has post-training-data breaking changes — read the bundled docs before nontrivial framework work.

## Screens (v1)

| Screen | Source | Notes |
|---|---|---|
| Trending (public landing) | new | per-field trend surveys from `/api/trending`; the anonymous entry point |
| Onboarding | adapt existing onboarding-chat | general-research questions; creates local profile; optional email registration at final step |
| Home / For-You feed | adapt | agentic feed with per-card "why" explanations; Trending as sibling tab |
| Paper digest | adapt | real Digest Skill output; "Add to knowledge base" button + ingest progress |
| **Reader** | **new** | HTML full text or pdf.js; persistent highlights; select → ask/capture |
| Wiki page view/edit | new | Milkdown WYSIWYG; wikilink navigation; frontmatter panel; backlinks |
| Wiki browser | new | type-directory tree + index; project tree (virtual) |
| Viz dashboard | new | four views: graph, timeline, citation flow, author network |
| Chat | adapt | global or project-scoped; citations open vault pages |
| Review queue | new | inbox cards with constrained one-click actions |
| Library | adapt | saved/liked/read-later from vault data |
| Settings | new | providers/keys, tier→model map, budget + AI spend panel, vault management (connect folder, export/import), companion chattiness |
| **Companion** | **new** | persistent small mascot (corner of the shell, all screens); text-only speech bubbles with action buttons + dismiss (no audio); subtle idle/celebration animations (framer-motion). **All chat surfaces in the app render as conversation with the companion** — onboarding, KB chat, select-to-ask, review discussions, spark sessions share one persona, one visual chat identity (the existing chat UI is re-skinned as companion conversation) |
| Spark | new | "Spark ideas" entry (global + per-project/topic); **Quick Spark** = inline companion conversation returning 2–3 seeds with "develop fully" buttons; **Deep Spark** = confirmation with cost estimate → run progress view (phases visible — grounding → bottleneck → ideation → scoop-check → card); idea cards gallery reading from `wiki/ideas/`; idea page view with status, depth, grounding links, scoop verdict, mini lit-review |

## Component commitments

- **Wiki editor: Milkdown** (ProseMirror-based WYSIWYG markdown). llm_wiki-proven — crib their integration for wikilink rendering/completion and frontmatter handling. "SciSpark owns the renderer" means this editor is ours to polish.
- **Graph: Sigma.js + graphology.** WebGL scaling to thousands of nodes; graphology supplies Louvain communities and Adamic-Adar for the borrowed relevance model. Node color by type/community, edge weight by relevance, hover-neighborhood, click → wiki page.
- **Reader: pdf.js** text layer + our highlight overlay. Highlight anchors = quoted text + position hints (robust to re-render; survives minor text-layer differences). HTML full texts (arXiv/PMC) render natively with the same selection/highlight machinery.
- Timeline / citation flow / author network: custom D3 over the derived dataset — no additional heavy library.

## Selection → AI interaction (the signature interaction)

One mechanism everywhere (reader, digest, wiki pages): select text → floating bubble with **Ask** (Reading-Companion Skill: answer grounded in the selection + paper + wiki neighborhood, in the right panel) / **Highlight** (persist to `highlights/`) / **Capture idea** (draft a `note` page linked to the source). All three log Tier-1 events that feed personalization.

## Non-goals for v1 UI

No visual redesign (design system carries over), no mobile layouts beyond what the fork already handles, no theming/dark mode, no collaborative cursors. The UI earns a real design pass after the product is validated (per Tong's layer ordering).
