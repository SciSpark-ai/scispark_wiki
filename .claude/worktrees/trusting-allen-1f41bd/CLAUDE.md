@AGENTS.md

# SciSpark Frontend

AI-powered clinical evidence assistant. Next.js 16 App Router with React 19, Tailwind CSS v4, Zustand, Framer Motion, Lucide icons.

## Stack

- **Framework**: Next.js 16.2 (App Router, `"use client"` for interactive pages)
- **Styling**: Tailwind CSS v4 with `@tailwindcss/postcss` — theme defined inline in `src/app/globals.css`
- **State**: Zustand stores in `src/stores/` (chat-store, ui-store, user-store)
- **Icons**: lucide-react
- **Animation**: framer-motion

## Project structure

- `src/app/` — App Router pages (home feed, chat, projects, paper detail, library, history, profile, onboarding)
- `src/components/` — Shared components organized by domain (feed/, layout/, shared/)
- `src/lib/mock-data/` — Mock data (papers.ts with Paper type)
- `src/stores/` — Zustand stores
- `src/hooks/` — Custom hooks (useFeed)

## Key routes

- `/` — Home feed with paper cards, tabs (For You/Trending/By Specialty), right sidebar
- `/chat` — New chat page with centered input
- `/chat/[id]` — Chat thread page
- `/projects` — Projects listing (folder-based organization like Claude Projects)
- `/projects/[id]` — Project detail with papers/chats/notes tabs
- `/paper/[id]` — Paper detail with AI summary, figure digest, breakpoints
- `/library` — Saved/liked/read-later papers
- `/history` — Chat history
- `/profile` — User profile

## Design system

- Warm earthy palette: espresso (#2b180a), orange (#f97316), page-bg (#fefaf5), page-warm (#f6f0e9)
- Font: Halant (serif headings), Geist Sans (body)
- Rounded corners: cards 28px, badges 8px, pills 50px
- Feed card headers colored by research topic (not specialty) via `TOPIC_COLORS` in FeedCard.tsx
- Three-column layout: left sidebar (240px) + main content + right panel (260px)

## Commands

- `npm run dev` — Start dev server on port 3000
- `npm run build` — Production build
- `npm run lint` — ESLint

## Conventions

- All page components use `"use client"` directive
- Mock data used throughout — no backend integration yet
- Sidebar nav items defined in `src/components/layout/Sidebar.tsx`
- Right panel content set per-page via `useUIStore.setRightPanel()`
