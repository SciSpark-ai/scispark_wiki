# AI Search/Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build the search landing page (`/chat`) and chat thread view (`/chat/[id]`) with reasoning animation, sources panel, multi-turn conversation, follow-up suggestions, and pinned input bar.

**Architecture:** A Zustand chat store holds sessions and messages. The search landing creates a new session and navigates to the thread. The thread page shows a multi-turn conversation with mock AI responses (delayed via setTimeout to simulate streaming). Sources panel uses the existing right panel system.

**Tech Stack:** Next.js App Router, Tailwind CSS v4, Framer Motion, Lucide React, Zustand

---

### Task 1: Chat Store & Mock Data

**Files:**
- Create: `src/stores/chat-store.ts`
- Create: `src/lib/mock-data/chat-responses.ts`

**Chat store shape:**
```ts
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  sections?: { heading: string; body: string }[];
  followUps?: string[];
  timestamp: number;
}

interface ChatSource {
  title: string;
  journal: string;
  url: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  sessions: ChatSession[];
  createSession: (question: string) => string; // returns session id
  addMessage: (sessionId: string, message: Omit<ChatMessage, "id" | "timestamp">) => void;
  getSession: (id: string) => ChatSession | undefined;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
}
```

Mock responses file: 3 pre-built AI responses for common neuro/psych questions, each with sections (heading + body), 5-8 sources, and 3 follow-up suggestions. A `getMockResponse(question: string)` function returns a random one.

---

### Task 2: Search Landing Page (`/chat`)

**Files:**
- Modify: `src/app/chat/page.tsx` — full rewrite

Layout: full-height, vertically centered content, no right panel.

- "SciSpark" logo: `font-heading text-[40px] text-espresso tracking-heading-tight`
- Search box: `max-w-[500px] w-full` centered
  - White bg, `border border-border-warm rounded-[16px] p-4`
  - Row: Search icon (muted, 18px) + input + send button (orange circle when text present)
  - Placeholder: "Ask about clinical evidence, treatments, guidelines..."
  - Submit on Enter or send button click
  - Empty submit: no-op
- Suggestion chips below search: `flex flex-wrap justify-center gap-2 mt-5`
  - 4 chips: "Compare treatments", "Summarize RCT", "Find guidelines", "Risk vs benefit"
  - Each: `bg-card-surface border border-border-warm rounded-pill px-3 py-1.5 text-[13px] text-espresso hover:bg-border-warm transition-colors flex items-center gap-1.5`
  - Icon (orange, 14px) + label
  - Click: populate input and auto-submit

On submit: call `createSession(question)` from chat store, navigate to `/chat/[newId]`

---

### Task 3: Chat Thread Page (`/chat/[id]`)

**Files:**
- Modify: `src/app/chat/[id]/page.tsx` — full rewrite

Layout: `flex flex-col h-full` — scrollable messages + pinned input bar at bottom.

**Scrollable area** (`flex-1 overflow-y-auto`):
- `max-w-3xl mx-auto px-8 py-8 space-y-6`
- Map session messages:
  - User message: centered pill `bg-page-warm rounded-[14px] px-6 py-3 text-[15px] text-espresso font-medium text-center max-w-lg mx-auto`
  - AI message: left-aligned structured prose
    - Each section: heading `font-heading text-[18px] text-espresso tracking-heading-card mb-2` + body `text-[15px] text-espresso leading-[1.75] tracking-body`
    - Inline citations: `bg-card-surface rounded-[4px] px-[7px] py-[1px] text-[11px] text-muted-text font-medium` (mock: just render [1], [2] etc.)
  - Action bar below each AI message: `border-t border-border-warm/30 pt-3 mt-4 flex items-center justify-between`
    - Left: Share, Download, Copy icons (16px, muted, hover→orange)
    - Center: Sources button `bg-orange text-white rounded-pill px-3 py-1 text-[12px] font-medium flex items-center gap-1.5` — "N sources" + FileText icon — onClick: open sources panel
    - Right: ThumbsUp, ThumbsDown icons (16px, muted)
  - Follow-up suggestions (only after last AI message): `space-y-2 mt-4`
    - Each: `border border-border-warm rounded-[10px] px-4 py-3 text-[14px] text-muted-text hover:bg-light-surface transition-colors cursor-pointer flex items-center gap-2`
    - ArrowRight icon (orange, 14px) + suggestion text
    - Click: submit as new user question

**Pinned input bar**: same style as onboarding/paper page — two-row input with + icon and send button.

**On new question submit**: add user message to store, trigger mock AI response after delay.

---

### Task 4: AI Reasoning Animation

**Files:**
- Create: `src/components/chat/ReasoningAnimation.tsx`

Shows while waiting for AI response. Framer Motion animated sequence:

1. **Phase 1 (0-1s)**: Pulsing dots + "Searching clinical evidence..." label
   - 3 dots animation: `animate={{ opacity: [0.3, 1, 0.3] }}` with stagger
   - Label: `text-[14px] text-muted-text`

2. **Phase 2 (1-2s)**: Source chips appear one by one
   - Small pills with journal names, fade in with 200ms stagger
   - `bg-card-surface rounded-pill px-2.5 py-1 text-[12px] text-muted-text`

3. **Phase 3 (2-3s)**: "Analyzing N sources..." label, sources stop appearing

Component props: `isVisible: boolean`, `onComplete: () => void`
Use `useEffect` with timeouts to progress through phases. Call `onComplete` at end.

---

### Task 5: Sources Panel

**Files:**
- Create: `src/components/chat/SourcesPanel.tsx`

Uses the existing right panel system (Zustand `setRightPanel` / `setShowRightPanel`).

Props: `sources: ChatSource[]`, `onClose: () => void`

Layout:
- Header: `flex items-center justify-between p-4 border-b border-border-warm/30`
  - "N sources" (`text-[14px] text-espresso font-bold`)
  - X close button
- List: each source
  - `px-4 py-3 border-b border-border-warm/30`
  - Warm-tan dot (6px circle) + domain name (12px, muted) on first line
  - Paper title (14px, espresso, leading-[1.4]) below
  - Hover: `bg-light-surface` transition

---

### Task 6: useChat Hook

**Files:**
- Create: `src/hooks/useChat.ts`

Wraps chat store with loading/reasoning logic for a single session:

```ts
function useChat(sessionId: string) {
  // Returns:
  // - session: ChatSession | undefined
  // - isLoading: boolean (true while generating response)
  // - sendMessage: (text: string) => void
  //   → adds user msg to store, sets isLoading=true,
  //     setTimeout 3s → adds mock AI response, sets isLoading=false
}
```

---

### Task 7: Wire It All Together & Polish

- Ensure `/chat` search creates session and navigates
- Ensure `/chat/[id]` loads session, shows messages, reasoning animation, follow-ups
- Sources button opens right panel with SourcesPanel
- Follow-up click submits as new question
- Auto-scroll to bottom on new messages
- Clear right panel on unmount

---

### Task 8: Sidebar Chat Management

**Files:**
- Modify: `src/components/layout/Sidebar.tsx` — replace hardcoded recentChats with live data from chat store
- Add hover `...` menu on each chat: Rename, Delete (with ConfirmDialog)
