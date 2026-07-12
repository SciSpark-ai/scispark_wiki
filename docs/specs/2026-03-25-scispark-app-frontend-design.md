# SciSpark App Frontend — Design Spec

**Date:** 2026-03-25
**Status:** Pending approval
**Project:** `scispark-app-frontend` — Perplexity-style clinical evidence workspace
**Repo:** New repo (`scispark-app-frontend`), separate from landing page

---

## 1. Overview

A Perplexity-inspired clinical evidence workspace for healthcare professionals. Users get a personalized paper feed (Home), an AI-powered search/chat for clinical questions (New Chat), a personal library for saved papers, and a history of past AI conversations.

**Key principles:**
- Frontend-only with mock data, but architected for real API integration later (abstract data layer via custom hooks like `useFeed()`, `useSearch()`, `useLibrary()`)
- Reuses the SciSpark visual standard from the landing page (same colors, typography, radii, spacing, motion)
- Perplexity's UX patterns adapted to clinical research context

## 2. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js (App Router) | Matches landing page, SSR-ready |
| Styling | Tailwind CSS v4 | CSS-based `@theme` config, same as landing page |
| Components | shadcn/ui | Consistent with landing page |
| Animation | Framer Motion | Sidebar transitions, panel slides, card hovers |
| Icons | Lucide React | Same as landing page |
| Fonts | Halant (headings) + Geist (body) | Same as landing page |
| State | Zustand | Lightweight global state for sidebar, panels, user profile |
| Data layer | Custom hooks with mock data | `useFeed()`, `useSearch()`, `useLibrary()`, `useHistory()`, `useUser()` — swap to real API later |
| Auth | Mock (hardcoded user) | Wire to real auth later |

## 3. Visual Standard

Reuse the SciSpark visual standard documented in `docs/visual-standard.md`. This is the **same document** used by the landing page — both projects share one design system. See Section 12 of the visual standard for the design philosophy that governs all SciSpark surfaces.

Key tokens:

| Token | Value |
|-------|-------|
| Page Background | `#fefaf5` |
| Page Warm | `#f6f0e9` |
| Card Surface | `#efe7dd` |
| Light Surface | `#faf6f2` |
| Espresso (text) | `#2b180a` |
| Muted Text | `#94877c` |
| Orange (accent) | `#f97316` |
| Border Warm | `#e8d3c0` |
| Warm Tan | `#dab697` |
| Heading font | Halant, Georgia, serif (weight 400) |
| Body font | Geist Sans, system-ui (weight 400/500) |
| Card radius | 28px |
| Button radius | 12px (standard), 50px (pill) |
| Card ease | `cubic-bezier(0.22, 1, 0.36, 1)` |

### Typography scale (app-specific)

All text uses negative tracking per the visual standard. Body text minimum is 14px.

| Element | Size | Tracking | Line height |
|---------|------|----------|-------------|
| Page title (greeting) | 24px | `tracking-heading` (-0.06em) | 110% |
| Section heading (Halant) | 20px | `tracking-heading` (-0.06em) | 110% |
| Card title (Halant) | 16px | `tracking-heading-card` (-0.05em) | 135% |
| AI answer heading (Halant) | 18px | `tracking-heading-card` (-0.05em) | 135% |
| AI answer body | 15px | `tracking-body` (-0.04em) | 175% |
| Body / nav item | 14px | `tracking-body` (-0.04em) | 150% |
| Card summary | 14px | `tracking-body` (-0.04em) | 150% |
| Card metadata | 12px | `tracking-body` (-0.04em) | 140% |
| Caption / label | 12px | `tracking-body` (-0.04em) | 140% |
| Inline citation badge | 11px | `tracking-body` (-0.04em) | — |
| Specialty header label | 10px | 0.06em (uppercase tracking) | — |

### Specialty color palette

| Specialty | Color | Fallback |
|-----------|-------|----------|
| Cardiology | `#ea580c` | — |
| Psychiatry | `#6b7280` | — |
| Oncology | `#d97706` | — |
| Pediatrics | `#f59e0b` | — |
| Neurology | `#4b5563` | — |
| Internal Medicine | `#059669` | — |
| Other / custom | `#94877c` | Default muted gray |

## 4. App Shell & Layout

### Three-panel structure

```
┌───────────┬────────────────────────┬────────────┐
│           │                        │            │
│   Left    │        Center          │   Right    │
│  Sidebar  │      (main view)       │  Sidebar   │
│   210px   │        flex-1          │   260px    │
│   fixed   │                        │  optional  │
│           │                        │            │
└───────────┴────────────────────────┴────────────┘
```

### Left Sidebar (always visible)

```
SciSpark (logo — Halant, 20px)

  Home              ← active: bg-card-surface, text-espresso
  New Chat
  Library
  History
  Profile

  ─────────────── (border-warm divider)

  RECENT CHATS (uppercase label, 12px, muted)
    GLP-1 vs SGLT2 for heart f...
    CAR-T therapy durability d...
    TMS protocol comparison...
```

- **Icons:** Lucide — Home, MessageSquarePlus, BookOpen, Clock, User
- **Nav item:** 9px 12px padding, rounded-[10px], 14px font, `tracking-body`
- **Active state:** `bg-card-surface` + `text-espresso` + `font-weight: 500`
- **Inactive:** `text-muted-text`
- **Recent chats:** 13px, muted text, truncated with ellipsis, clicking opens thread
- **Current chat:** highlighted with `bg-card-surface` + font-weight 500
- **Mobile:** Collapsible via hamburger menu (see Section 15: Responsive)

### Right Sidebar (contextual)

| View | Right sidebar |
|------|---------------|
| Home | Stats widgets (Your Week, Trending Topics, Reading Streak) |
| Chat thread | Sources panel (toggled by "sources" button) |
| New Chat | None |
| Library | None |
| History | None |
| Profile | None |
| Onboarding | None |

- Slides in/out with Framer Motion (`x: 260` → `x: 0`, card ease, 300ms)
- Closeable with X button (sources panel)

### Routing

| Route | View | Right sidebar |
|-------|------|---------------|
| `/` | Home (feed) | Stats widgets |
| `/chat` | New Chat (search landing) | None |
| `/chat/[id]` | Chat thread | Sources (toggleable) |
| `/library` | Library | None |
| `/history` | Chat history list | None |
| `/profile` | User settings | None |
| `/onboarding` | Conversational onboarding | None |

### Zustand stores

**`ui-store.ts`:**
```ts
{
  sidebarOpen: boolean;          // mobile sidebar toggle
  sourcesPanelOpen: boolean;     // right sidebar (chat view)
  activeNav: string;             // current nav item key
}
```

**`user-store.ts`:**
```ts
{
  user: User | null;             // profile data (name, email, avatar)
  onboardingComplete: boolean;   // gates access to main app
  preferences: {
    specialty: string;
    role: string;
    interests: string[];
    literatureHabits: string;
  };
}
```

Hooks read from these stores. `useUser()` wraps `user-store`, `useFeed()` reads `preferences` to filter papers.

## 5. Onboarding

**Route:** `/onboarding` — first-time users land here after signup.

### Layout
- Full app shell with sidebar **visible but disabled**
- Nav items at `opacity-40`, `pointer-events-none`, no hover states
- Center area: chat-style conversation, max-width ~460px, centered

### Conversation flow

AI agent asks 4 questions sequentially. Each question has:
- **AI message bubble** — left-aligned, white bg, `border border-border-warm`, `rounded-[16px] rounded-bl-[4px]`
- **Selection chips** — pill-shaped below the message, clickable
- **Custom input** — text field below chips: "Or type your own..."
- **User response** — right-aligned, `bg-orange text-white`, `rounded-[16px] rounded-br-[4px]`
- Next question animates in after selection (fade up, 400ms)

### Questions

1. **Specialty:** "What's your primary clinical specialty?"
   - Chips: Cardiology, Oncology, Psychiatry, Neurology, Pediatrics, Internal Medicine
   - Custom input option

2. **Role:** "And what's your role?"
   - Chips: Attending Physician, Researcher, Resident, Fellow, NP/PA
   - Custom input option

3. **Interests:** "What topics are you most interested in?" *(multi-select)*
   - Chips: Evidence-based guidelines, Drug trials, Surgical techniques, AI in medicine, Public health, Rare diseases
   - Custom input option

4. **Literature habits:** "How do you currently keep up with literature?"
   - Chips: PubMed alerts, Journal subscriptions, Colleague recommendations, Twitter/X, I don't (that's why I'm here)
   - Custom input option

### Completion

- AI summary message: "Great! I've set up your feed based on your interests. Let's get started."
- CTA button: "Explore your feed →" (orange pill button)
- On click: sidebar activates, route to `/` (Home)

### Data handling

- Answers collected in local state during the flow
- On completion: `submitOnboarding(answers)` — mock function now, real API later
- Saved to `user-store` preferences, used by feed personalization and AI chat

## 6. Home (Evidence Feed)

**Route:** `/`

### Header

- **Greeting:** "Good evening, **Tong**" — time-aware (morning/afternoon/evening), user's first name in orange
- **Subtitle:** "Explore the latest research in your interests."

### Filter tabs

Below greeting, border-bottom underline style:
- **For You** (default) — personalized based on profile
- **Trending** — highest engagement across all specialties
- **By Specialty** — clicking reveals a row of specialty pill chips to filter (e.g. Cardiology, Oncology, etc.), selecting one filters the feed

Active tab: `text-espresso font-weight-500`, orange underline (2px).
Inactive: `text-muted-text`.

### Card grid

2-column responsive grid (`grid-cols-1 md:grid-cols-2 gap-[14px]`). 1-column on mobile.

### Card design

Each card:
```
┌─────────────────────────────────┐
│ ███ CARDIOLOGY ████████████████ │ ← specialty color header (30px)
│                                 │   with grain texture overlay
│ GLP-1 Receptor Agonists Reduce  │ ← title (Halant, 16px)
│ Major Adverse Cardiac Events    │
│                                 │
│ Large-scale trial demonstrates  │ ← summary (14px, muted, 2-line clamp)
│ semaglutide significantly...    │
│                                 │
│ NEJM · 2025 · New This Week    │ ← metadata (12px, muted)
│                                 │
│─────────────────────────────────│
│ ★★★★★          ♡  🔖  ⏰  ··· │ ← stars + actions + more menu
└─────────────────────────────────┘
```

- **Header:** Specialty color bg, grain overlay (heavy), uppercase label (10px, white/90, letter-spacing 0.06em)
- **Title:** Halant serif, 16px, weight 400, espresso, `tracking-heading-card`, `line-height: 1.35`
- **Summary:** 14px, muted text, `tracking-body`, `line-clamp-2`
- **Metadata:** 12px, muted: Journal · Year · Badge
- **Footer border:** `border-top: 1px solid #f6f0e9`
- **Stars:** 12px, warm-tan filled / border-warm empty
- **Action icons:** Heart (like), Bookmark (save), Clock (read later) — 15px, muted, hover → orange
- **More menu (`...`):** MoreHorizontal icon, dropdown on click:
  - Not Interested (X icon)
  - Copy Citation (Copy icon)
  - Share (Share icon)

**Card interactions:**
- Hover: `translateY(-4px)` + `box-shadow: 0 8px 30px rgba(0,0,0,0.08)`
- Click: opens paper digest (see Section 6a)

### 6a. Paper Digest View

When a card is clicked, a full-width modal overlay slides up (Framer Motion, `y: 100% → 0`, card ease, 400ms) with:

- **Back button** (top-left): "← Back to feed"
- **Specialty header bar** (full width, with grain)
- **Paper title** (Halant, 24px)
- **Journal · Year · Authors** (14px, muted)
- **AI-generated TL;DR** section (16px body, highlighted bg)
- **Key findings** (bullet points, 15px)
- **Evidence rating** (stars + explanation)
- **Tags** (pill chips)
- **Action bar:** Like, Save, Read Later, Copy Citation, Share
- **Link to original paper** (external link icon)

This is a modal overlay, not a separate route. Closing returns to the feed.

### Right sidebar widgets

**Widget 1 — Your Week:**
3 stat rows, each in a white rounded-[10px] card with `border border-border-warm`:
| Icon | Number | Label |
|------|--------|-------|
| File (orange/10 bg) | 18 | New in your interests |
| TrendingUp (orange/10 bg) | 5 | Trending in your fields |
| Eye (orange/10 bg) | 2 | Saved & unread |

**Widget 2 — Trending Topics:**
Ranked list (1-5):
- Rank 1-2: orange bg circle (hot)
- Rank 3-5: card-surface bg circle
- Topic name + paper count (right-aligned, muted)

**Widget 3 — Reading Streak:**
- Large number (28px, orange, bold)
- "day streak" label
- M-T-W-T-F-S-S dot row: filled (orange) for active days, empty (border-warm) for inactive

## 7. New Chat (Search Landing)

**Route:** `/chat`

### Layout
Center only, full-height, vertically centered content.

### Content
- **Logo:** "SciSpark" (Halant, 40px, espresso)
- **Search box:** max-width 500px, white bg, `border 1.5px border-warm`, rounded-16px, 16px padding
  - Search icon (left, muted)
  - Placeholder: "Ask about clinical evidence, treatments, guidelines..."
  - Submit on Enter key or clicking send icon (right side)
  - Empty submit: no-op (ignore)
- **Suggestion chips:** flex wrap, centered, 8px gap
  - Each chip: `bg-card-surface border border-border-warm rounded-pill`, 13px text, icon (orange) + label
  - Chips: Compare treatments, Summarize RCT, Find guidelines, Risk vs benefit
  - Hover: `bg-border-warm`
  - Click: populates search box with chip text and submits

### On submit
- Create new chat session
- Route to `/chat/[new-id]`
- Show AI reasoning animation (see Section 8a) then answer

## 8. Chat Thread (Answer View)

**Route:** `/chat/[id]`

### Layout
Center (scrollable) + right sidebar (sources panel, toggled).

### Center content

1. **User question:** centered, `bg-page-warm rounded-14px`, 15px, font-weight 500, espresso

2. **AI answer:** structured prose
   - Section headings: Halant serif, 18px, weight 400, `tracking-heading-card`
   - Body: 15px, espresso, `line-height: 1.75`, `tracking-body`
   - Inline citations: `bg-card-surface rounded-[4px] px-7px py-1px`, 11px, muted text, font-weight 500

3. **Action bar:** below answer, `border-top border-border-warm`, flex row
   - Icons: Share, Download, Copy (16px, muted)
   - Sources button: `bg-orange text-white rounded-pill`, 12px, "N sources" + file icon
   - Thumbs up / down (right-aligned, muted)

4. **Follow-up suggestions:** clickable rows
   - `border border-border-warm rounded-10px`, 14px, muted text
   - Arrow icon (orange) + suggestion text
   - Hover: `bg-light-surface`

5. **Input bar:** pinned to bottom
   - `border-top border-border-warm`, 14px padding
   - Plus icon (left) + "Ask a follow-up..." placeholder + send icon (right, orange)
   - Submit on Enter

### 8a. AI Reasoning Animation

When waiting for an AI answer (after user submits a question), show a reasoning sequence:

1. **Thinking indicator** — pulsing dot animation below user question, "Searching clinical evidence..." label (14px, muted)
2. **Source discovery** — source chips appear one by one (fade in, 200ms stagger): small pills showing journal names being found
3. **Analyzing** — label changes to "Analyzing 12 sources...", sources stop appearing
4. **Answer streams in** — reasoning animation fades out, answer sections appear with a typewriter-style reveal (content fades in paragraph by paragraph, 300ms stagger)

Total mock duration: ~3 seconds (fake delay via `setTimeout`). In production, this maps to real streaming responses.

### Right sidebar (sources panel)

- Triggered by clicking "N sources" button
- Header: "N sources" (14px, bold) + X close button
- List of sources:
  - Dot indicator (warm-tan, 6px circle)
  - Domain name (12px, muted)
  - Paper title (14px, espresso, 1.4 line-height)
  - Separated by `border-bottom border-border-warm`
- Slide animation: Framer Motion, `x: 260 → 0`, card ease, 300ms

### Multi-turn
Follow-up questions append to the thread. Each answer gets its own action bar and source count. Thread scrolls to newest content.

### Chat management
- Each thread in sidebar has a `...` menu on hover: Rename, Delete
- Delete shows a confirmation dialog

## 9. Library

**Route:** `/library`

### Layout
Center only.

### Content

- **Page title:** "Library" (Halant, 20px, `tracking-heading`)
- **Tab pills:** Saved (default) | Liked | Read Later
  - Active: `bg-orange text-white rounded-pill`
  - Inactive: `bg-card-surface text-muted-text rounded-pill`
  - 7px 16px padding, 13px font, font-weight 500

- **List view:** Each item is a row:
  - Left: specialty color bar (4px wide, 40px tall, rounded-2px)
  - Title: Halant, 16px, espresso, `tracking-heading-card`
  - Metadata: Journal · Year · Specialty · Star rating (12px, muted)
  - Separated by `border-bottom border-border-warm`
  - Click → opens paper digest (same modal as feed)

- **Empty state:** "No saved papers yet. Browse your feed to start saving." + "Go to feed →" link

## 10. History

**Route:** `/history`

### Layout
Center only.

### Content

- **Page title:** "History" (Halant, 20px, `tracking-heading`)
- **Grouped by date:** Today / Yesterday / This Week / Earlier
  - Group label: 12px, uppercase, muted, font-weight 500, letter-spacing 0.06em
- **Each item:**
  - Thread title (first question, truncated) — 14px, espresso
  - Timestamp (right-aligned, 12px, muted)
  - Click → opens `/chat/[id]`
  - Hover: `bg-light-surface rounded-10px`
  - `...` menu on hover: Rename, Delete (with confirmation)

- **Empty state:** "No conversations yet. Start a new chat to ask clinical questions." + "New Chat →" link

## 11. Profile

**Route:** `/profile`

### Layout
Center only.

### Content

- **User info:** Name, email, avatar (or initials circle in `bg-orange text-white`)
- **Editable preferences** (from onboarding):
  - Specialty (dropdown)
  - Role (dropdown)
  - Interests (multi-select chips, add/remove)
  - Literature habits (dropdown)
- **Settings:**
  - Language toggle (EN / ZH)
  - Notification preferences
- **Sign out** button (outline style, `border border-espresso/20 rounded-pill`)

## 12. Data Layer Architecture

Abstract all data access behind hooks so mock data can be swapped for real APIs:

```
src/
  hooks/
    useFeed.ts        → returns paper cards for home feed
    useSearch.ts      → submits query, returns AI answer + sources
    useLibrary.ts     → returns saved/liked/read-later papers
    useHistory.ts     → returns past chat sessions
    useUser.ts        → returns user profile, update preferences
    useOnboarding.ts  → submits onboarding answers
  lib/
    mock-data/
      papers.ts       → sample paper data (10+ papers across specialties)
      chat-threads.ts → sample chat conversations (3+ threads)
      user.ts         → hardcoded user profile
```

Each hook returns `{ data, isLoading, error }` pattern. When real API is ready, swap the implementation inside the hook without changing any component code.

Mock hooks use `setTimeout` to simulate loading delays (300-500ms) for realistic skeleton states.

## 13. Loading, Error & Empty States

### Loading states
- **Feed:** 4 skeleton cards (pulsing `bg-card-surface` rectangles matching card layout)
- **Chat reasoning:** See Section 8a (AI Reasoning Animation)
- **Library / History:** 3 skeleton rows (pulsing bars)
- **Skeleton animation:** `animate-pulse` on `bg-card-surface` blocks

### Error states
- **All views:** Centered error message: "Something went wrong. Please try again." + "Retry" button (orange outline)
- Simple and generic — specifics come when real API is integrated

### Empty states
- **Feed:** Should never be empty (always has recommendations), but fallback: "No papers match your filters."
- **Library:** "No saved papers yet. Browse your feed to start saving." + "Go to feed →"
- **History:** "No conversations yet. Start a new chat to ask clinical questions." + "New Chat →"
- **Search results:** "No results found. Try rephrasing your question."

## 14. File Structure

```
scispark-app-frontend/
  src/
    app/
      layout.tsx              ← app shell (sidebar + main area)
      page.tsx                ← Home (feed)
      chat/
        page.tsx              ← New Chat (search landing)
        [id]/
          page.tsx            ← Chat thread
      library/
        page.tsx              ← Library
      history/
        page.tsx              ← History
      profile/
        page.tsx              ← Profile
      onboarding/
        page.tsx              ← Onboarding flow
      globals.css             ← Tailwind v4 theme (same tokens as landing page)
    components/
      layout/
        AppShell.tsx          ← three-panel layout container
        Sidebar.tsx           ← left sidebar nav
        RightPanel.tsx        ← right sidebar container (contextual)
        MobileNav.tsx         ← hamburger + slide-over sidebar
      feed/
        FeedCard.tsx          ← paper card component
        FeedGrid.tsx          ← 2-column card grid
        CardMoreMenu.tsx      ← "..." dropdown (Not Interested, Copy Citation, Share)
        FeedTabs.tsx          ← For You / Trending / By Specialty
        PaperDigest.tsx       ← full paper detail modal overlay
      chat/
        SearchLanding.tsx     ← centered search box + chips
        ChatThread.tsx        ← scrollable message thread
        ChatMessage.tsx       ← single AI answer block
        CitationBadge.tsx     ← inline citation chip
        ActionBar.tsx         ← share/copy/sources/thumbs bar
        FollowUpList.tsx      ← suggested follow-up rows
        ChatInput.tsx         ← bottom input bar
        SourcesPanel.tsx      ← right sidebar source list
        ReasoningAnimation.tsx ← thinking/loading state
      library/
        LibraryTabs.tsx       ← Saved / Liked / Read Later
        LibraryItem.tsx       ← single paper row
      history/
        HistoryGroup.tsx      ← date-grouped list
        HistoryItem.tsx       ← single thread row
      onboarding/
        OnboardingChat.tsx    ← conversational flow container
        AIMessage.tsx         ← AI question bubble
        UserMessage.tsx       ← user response bubble
        SelectionChips.tsx    ← option pills + custom input
      widgets/
        YourWeek.tsx          ← stat cards widget
        TrendingTopics.tsx    ← ranked topic list
        ReadingStreak.tsx     ← streak tracker
      shared/
        GrainOverlay.tsx      ← reused from landing page
        StarsRating.tsx       ← evidence star display
        SkeletonCard.tsx      ← loading skeleton
        EmptyState.tsx        ← empty state with message + CTA
        ConfirmDialog.tsx     ← delete confirmation
    hooks/
      useFeed.ts
      useSearch.ts
      useLibrary.ts
      useHistory.ts
      useUser.ts
      useOnboarding.ts
    lib/
      mock-data/
        papers.ts
        chat-threads.ts
        user.ts
    stores/
      ui-store.ts             ← sidebar state, sources panel open/close
      user-store.ts           ← user profile, onboarding state
```

## 15. Responsive Behavior

### Breakpoints
- **Desktop (lg, 1024px+):** Full three-panel layout
- **Tablet (md, 768px–1023px):** Left sidebar collapses, hamburger menu, right sidebar overlays
- **Mobile (< 768px):** Single column, hamburger menu, right sidebar as full-screen overlay

### Mobile navigation
- **Hamburger icon:** Top-left corner, 48px touch target, in a slim top bar (50px height, `bg-page-bg border-b border-border-warm/20`)
- **Logo:** Centered in top bar
- **Sidebar:** Slides in from left as overlay (`z-50`), backdrop blur + `bg-espresso/30`
- **Close:** X button or tap backdrop

### Right sidebar on mobile
- **Home widgets:** Hidden on mobile (stats available in profile or future dedicated view)
- **Sources panel (chat):** Slides up as a bottom sheet (80vh max-height), `rounded-t-card`, drag handle at top

### Feed grid
- Desktop: 2 columns
- Mobile: 1 column, full-width cards

## 16. Build Order (Sub-projects)

1. **Shell & Navigation** — layout skeleton, sidebar, routing, responsive, disabled sidebar state
2. **Onboarding** — conversational flow, profile creation
3. **Home (Feed)** — greeting, tabs, card grid, right sidebar widgets, card more menu, paper digest modal
4. **AI Search/Chat** — search landing, chat thread, reasoning animation, sources panel, follow-ups
5. **Library** — tabs, paper list, empty states
6. **History** — grouped thread list, chat management (rename/delete)
7. **Profile** — user info, editable preferences

Each sub-project gets its own implementation plan and can be built independently.
