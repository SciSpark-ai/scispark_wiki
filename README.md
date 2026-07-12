# SciSpark Frontend

AI-powered clinical evidence assistant. SciSpark helps researchers and clinicians browse curated literature, dig into AI-generated digests, chat with an evidence-aware agent, and organize findings into project notebooks.

This repo is a **prototype frontend** — all data is mocked, there is no backend integration yet. State that *would* live in a database is persisted to `localStorage` via Zustand.

## Stack

- **Next.js 16.2** (App Router, React 19) — every interactive page uses `"use client"`
- **Tailwind CSS v4** via `@tailwindcss/postcss`, theme defined inline in `src/app/globals.css`
- **Zustand** (with `persist` middleware) for global state
- **framer-motion** for transitions and the streaming chat UI
- **lucide-react** for iconography
- **Halant** (serif headings) + **Geist Sans** (body)

> ⚠️ This Next.js version has breaking changes from older training data. Before writing code, see [`AGENTS.md`](./AGENTS.md) and read the relevant guide in `node_modules/next/dist/docs/`.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Other commands:

```bash
npm run build        # production build
npm run lint         # ESLint
```

## Feature highlights

- **Home feed** (`/`) — topic-colored paper cards with For You / Trending / By Specialty tabs, plus inline "Your Week", "Trending Topics", and "Reading Streak" widgets.
- **Paper detail** (`/paper/[id]`) — AI summary (lay vs. abstract toggle), figure digest, breakpoints, related papers, code/data links. Like, Save, and Read-Later actions persist across the app.
- **YouTube-style Save menu** — clicking *Save* on a paper opens a "Save to…" popover with a top **Library** row (project-less stash) and one row per project, each with independent membership toggles.
- **Chat thread** (`/chat/[id]`) — multi-step "Thinking" agent bubble (search → screen → extract → synthesize → done), then a word-by-word streaming answer with clickable `[N]` citations that open the right-side Sources panel highlighted to the right source. The reasoning trace stays in the conversation as a collapsible bubble.
- **Highlight to note** — selecting text in any paper body or chat assistant message surfaces a floating "Save to note" bubble with a project picker. Notes also seed from a manual "+ Add Note" action on the project page.
- **Editable notes** — every note opens in a centered modal for full editing (autosave on blur). Cards in the grid show clamped previews with footers aligned along a common baseline.
- **Projects** (`/projects`, `/projects/[id]`) — Claude-Projects-style organization with Chats / Notes / Papers tabs, project instructions, and quick actions.
- **Library / History / Profile** — saved / liked / read-later buckets, chat history, and user preferences.
- **Page transitions** — framer-motion `AnimatePresence` cross-fade between routes, keyed on the top-level segment so dynamic param changes don't blink.

## Project layout

```
src/
├── app/                    # App Router pages
│   ├── page.tsx            # Home feed
│   ├── chat/               # /chat, /chat/[id]
│   ├── paper/[id]/         # Paper detail
│   ├── projects/           # /projects, /projects/[id]
│   ├── library/            # Saved / Liked / Read Later
│   ├── history/            # Chat history
│   ├── profile/            # Profile + preferences
│   ├── onboarding/         # First-run questionnaire
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Tailwind v4 theme + base styles
├── components/
│   ├── layout/             # AppShell, Sidebar, MobileNav, RightPanel
│   ├── feed/               # FeedCard, FeedTabs, widgets
│   ├── chat/               # ReasoningAnimation, SourcesPanel
│   ├── papers/             # SaveToProjectMenu
│   ├── notes/              # SelectionToNoteBubble, NoteCard, NoteEditorModal
│   ├── onboarding/         # OnboardingChat, AIMessage, etc.
│   └── shared/             # ShareButton, StarsRating, GrainOverlay, …
├── stores/                 # Zustand stores (see CLAUDE.md for full list)
├── hooks/                  # useFeed, useChat, useOnboarding
└── lib/
    ├── fonts.ts
    ├── onboarding-questions.ts
    └── mock-data/          # papers.ts, projects.ts, chat-responses.ts, seed-chat.ts
```

## Environment variables

Server-only proxy backend for the paper search/resolve/fetch relay (`/api/search/[source]`, `/api/resolve`, `/api/fetch`). Copy `.env.example` to `.env.local` and fill in what you need — none are exposed to the client bundle.

| Variable          | Required?                       | Purpose                                                              |
| ------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `OPENALEX_MAILTO`  | Recommended                      | OpenAlex "polite pool" contact email — faster/more reliable rate limits |
| `UNPAYWALL_EMAIL`  | Required for `/api/resolve`      | Unpaywall requires a contact email on every request; missing it returns 503 |
| `S2_API_KEY`       | Optional                         | Semantic Scholar API key — better rate limits on `/api/search/s2`   |
| `NCBI_API_KEY`     | Optional                         | NCBI/PubMed API key — better rate limits on `/api/search/pubmed`    |

## Persistence

The following data is mirrored to `localStorage` and survives reloads:

| Store                  | Key                          | Holds                                              |
| ---------------------- | ---------------------------- | -------------------------------------------------- |
| `paper-actions-store`  | `scispark-paper-actions`     | per-paper `liked / saved / readLater` flags        |
| `notes-store`          | `scispark-notes`             | project notes (highlight-captured + manual)        |
| `project-papers-store` | `scispark-project-papers`    | paper ↔ project membership                         |

Clear the keys in DevTools → Application → Local Storage to reset.

## Design system

- **Palette**: espresso `#2b180a`, orange `#f97316`, page-bg `#fefaf5`, page-warm `#f6f0e9`, warm-tan accents
- **Type**: Halant serif headings, Geist Sans body, Geist Mono for code
- **Shape**: cards 28 px, badges 8 px, pills 50 px
- Feed card headers are colored by **research topic** (not specialty) via `TOPIC_COLORS` in `FeedCard.tsx`

## Contributing notes

- See [`CLAUDE.md`](./CLAUDE.md) for conventions and architectural notes that govern how new features should be wired (highlight zones, citation parsing, streaming, page transitions).
- See [`AGENTS.md`](./AGENTS.md) for caveats about working with this Next.js version.
