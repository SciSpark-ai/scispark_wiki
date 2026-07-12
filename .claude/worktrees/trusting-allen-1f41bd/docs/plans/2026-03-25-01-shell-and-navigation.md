# Shell & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js app with Tailwind v4, set up the three-panel layout shell (left sidebar, center content, optional right panel), Zustand stores, routing, responsive behavior, and placeholder pages for all views.

**Architecture:** Next.js App Router with a root layout that renders the AppShell (sidebar + center + right panel). Zustand manages UI state (sidebar open, sources panel). Each route renders a placeholder page inside the center panel. The sidebar has a disabled state for onboarding.

**Tech Stack:** Next.js (App Router), Tailwind CSS v4, Zustand, Framer Motion, Lucide React, Halant + Geist fonts

**Spec:** `docs/specs/2026-03-25-scispark-app-frontend-design.md` — Sections 2, 3, 4, 14, 15

---

## File Structure

```
scispark-app-frontend/
  src/
    app/
      layout.tsx              ← root layout: fonts, metadata, AppShell wrapper
      page.tsx                ← Home placeholder
      chat/
        page.tsx              ← New Chat placeholder
        [id]/
          page.tsx            ← Chat thread placeholder
      library/
        page.tsx              ← Library placeholder
      history/
        page.tsx              ← History placeholder
      profile/
        page.tsx              ← Profile placeholder
      onboarding/
        page.tsx              ← Onboarding placeholder
      globals.css             ← Tailwind v4 @theme with SciSpark design tokens
    components/
      layout/
        AppShell.tsx          ← three-panel container
        Sidebar.tsx           ← left sidebar nav + recent chats
        RightPanel.tsx        ← right sidebar container (contextual)
        MobileNav.tsx         ← hamburger top bar + slide-over sidebar
    stores/
      ui-store.ts             ← sidebar open, sources panel, active nav
      user-store.ts           ← user profile, onboarding flag, preferences
    lib/
      fonts.ts                ← Halant + Geist font loading
```

---

### Task 1: Scaffold Next.js project

**Files:**
- Create: entire project scaffold via `create-next-app`
- Modify: `package.json` (add dependencies)

- [ ] **Step 1: Create Next.js app**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --turbopack
```

When prompted, accept defaults. If it asks about existing files, allow overwrite (only `docs/` exists and should be preserved).

- [ ] **Step 2: Verify scaffold works**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run dev
```

Expected: Dev server starts at localhost:3000 with default Next.js page.

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm install zustand framer-motion lucide-react
npx shadcn@latest init
```

- [ ] **Step 4: Verify build passes**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
# Verify .gitignore is present and includes node_modules, .next, etc.
cat .gitignore
git add .gitignore package.json package-lock.json tsconfig.json next.config.ts next-env.d.ts src/ public/ eslint.config.mjs components.json
git commit -m "feat: scaffold Next.js app with Tailwind, shadcn/ui, Zustand, Framer Motion"
```

---

### Task 2: Configure Tailwind v4 design tokens and fonts

**Files:**
- Modify: `src/app/globals.css` (replace with SciSpark tokens)
- Create: `src/lib/fonts.ts` (Halant + Geist font loading)
- Modify: `src/app/layout.tsx` (wire fonts)

- [ ] **Step 1: Replace globals.css with SciSpark design tokens**

Replace the entire contents of `src/app/globals.css` with:

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-geist-sans), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-halant), Georgia, serif;
  --font-body: var(--font-geist-sans), system-ui, sans-serif;

  --color-page-bg: #fefaf5;
  --color-page-warm: #f6f0e9;
  --color-card-surface: #efe7dd;
  --color-light-surface: #faf6f2;
  --color-espresso: #2b180a;
  --color-secondary-dark: #3e2407;
  --color-muted-text: #94877c;
  --color-orange: #f97316;
  --color-orange-light: #fb923c;
  --color-warm-tan: #dab697;
  --color-border-warm: #e8d3c0;
  --color-gold: #fde68a;

  --tracking-heading-tight: -0.07em;
  --tracking-heading: -0.06em;
  --tracking-heading-card: -0.05em;
  --tracking-body: -0.04em;

  --radius-card: 28px;
  --radius-badge: 8px;
  --radius-btn: 12px;
  --radius-pill: 50px;
  --radius-faq: 16px;
}

@layer base {
  body {
    background-color: #fefaf5;
    color: #2b180a;
    font-family: var(--font-body);
  }
  html {
    scroll-behavior: smooth;
  }
  ::selection {
    background-color: #e8d3c0;
    color: #2b180a;
  }
}

@layer utilities {
  .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
  .scrollbar-hide::-webkit-scrollbar { display: none; }
}
```

- [ ] **Step 2: Create font loading utility**

Create `src/lib/fonts.ts`:

```ts
import { Geist, Geist_Mono, Halant } from "next/font/google";

export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const halant = Halant({
  variable: "--font-halant",
  subsets: ["latin"],
  weight: ["400", "700"],
});
```

> **Note:** If `Halant` is not available as a named export from `next/font/google` in your Next.js version, download the font files and use `next/font/local` instead.

- [ ] **Step 3: Update root layout to wire fonts**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { geistSans, geistMono, halant } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "SciSpark",
  description: "AI-powered clinical evidence workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${halant.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

Expected: Build passes. Fonts are loaded.

- [ ] **Step 5: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git add src/app/globals.css src/lib/fonts.ts src/app/layout.tsx
git commit -m "feat: configure Tailwind v4 tokens and Halant + Geist fonts"
```

---

### Task 3: Create Zustand stores

**Files:**
- Create: `src/stores/ui-store.ts`
- Create: `src/stores/user-store.ts`

- [ ] **Step 1: Create UI store**

Create `src/stores/ui-store.ts`:

```ts
import { create } from "zustand";

interface UIState {
  sidebarOpen: boolean;
  sourcesPanelOpen: boolean;
  activeNav: string;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSourcesPanelOpen: (open: boolean) => void;
  toggleSourcesPanel: () => void;
  setActiveNav: (nav: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  sourcesPanelOpen: false,
  activeNav: "home",
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSourcesPanelOpen: (open) => set({ sourcesPanelOpen: open }),
  toggleSourcesPanel: () =>
    set((s) => ({ sourcesPanelOpen: !s.sourcesPanelOpen })),
  setActiveNav: (nav) => set({ activeNav: nav }),
}));
```

- [ ] **Step 2: Create user store**

Create `src/stores/user-store.ts`:

```ts
import { create } from "zustand";

interface UserPreferences {
  specialty: string;
  role: string;
  interests: string[];
  literatureHabits: string;
}

interface User {
  name: string;
  email: string;
  avatar?: string;
}

interface UserState {
  user: User | null;
  onboardingComplete: boolean;
  preferences: UserPreferences;
  setUser: (user: User) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setPreferences: (prefs: Partial<UserPreferences>) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: {
    name: "Tong",
    email: "tong@scispark.ai",
  },
  onboardingComplete: false, // new users start with onboarding; set to true after completion
  preferences: {
    specialty: "Cardiology",
    role: "Researcher",
    interests: ["Evidence-based guidelines", "Drug trials"],
    literatureHabits: "PubMed alerts",
  },
  setUser: (user) => set({ user }),
  setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),
  setPreferences: (prefs) =>
    set((s) => ({ preferences: { ...s.preferences, ...prefs } })),
}));
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git add src/stores/
git commit -m "feat: add Zustand UI and user stores"
```

---

### Task 4: Build Sidebar component

**Files:**
- Create: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create Sidebar component**

Create `src/components/layout/Sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquarePlus,
  BookOpen,
  Clock,
  User,
} from "lucide-react";
import { useUserStore } from "@/stores/user-store";

const navItems = [
  { key: "home", label: "Home", href: "/", icon: Home },
  { key: "chat", label: "New Chat", href: "/chat", icon: MessageSquarePlus },
  { key: "library", label: "Library", href: "/library", icon: BookOpen },
  { key: "history", label: "History", href: "/history", icon: Clock },
  { key: "profile", label: "Profile", href: "/profile", icon: User },
] as const;

const recentChats = [
  { id: "1", title: "GLP-1 vs SGLT2 for heart failure" },
  { id: "2", title: "CAR-T therapy durability data" },
  { id: "3", title: "TMS protocol comparison" },
];

export function Sidebar() {
  const pathname = usePathname();
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);
  const isOnboarding = pathname === "/onboarding";
  const disabled = isOnboarding && !onboardingComplete;

  return (
    <aside className="w-[210px] bg-page-warm border-r border-border-warm flex flex-col h-full p-[10px] flex-shrink-0">
      {/* Logo */}
      <div className="px-[10px] pb-5">
        <span className="font-heading text-[20px] text-espresso tracking-heading">
          SciSpark
        </span>
      </div>

      {/* Nav items */}
      <nav
        className={
          disabled ? "opacity-40 pointer-events-none" : ""
        }
      >
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-center gap-[10px] px-3 py-[9px] rounded-[10px] text-[14px] tracking-body transition-colors ${
                isActive
                  ? "bg-card-surface text-espresso font-medium"
                  : "text-muted-text hover:bg-card-surface/50"
              }`}
            >
              <Icon size={18} strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <hr className="border-border-warm mx-[10px] my-[14px]" />

      {/* Recent chats */}
      <div
        className={
          disabled ? "opacity-40 pointer-events-none" : ""
        }
      >
        <p className="text-[12px] uppercase tracking-[0.06em] text-muted-text font-medium px-3 pb-2">
          Recent Chats
        </p>
        {recentChats.map((chat) => (
          <Link
            key={chat.id}
            href={`/chat/${chat.id}`}
            className={`block text-[13px] text-muted-text px-3 py-[5px] rounded-[6px] truncate leading-[1.4] hover:bg-card-surface/50 transition-colors ${
              pathname === `/chat/${chat.id}`
                ? "bg-card-surface text-espresso font-medium"
                : ""
            }`}
          >
            {chat.title}
          </Link>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />
    </aside>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git add src/components/layout/Sidebar.tsx
git commit -m "feat: add Sidebar component with nav items and recent chats"
```

---

### Task 5: Build RightPanel and MobileNav components

**Files:**
- Create: `src/components/layout/RightPanel.tsx`
- Create: `src/components/layout/MobileNav.tsx`

- [ ] **Step 1: Create RightPanel component**

Create `src/components/layout/RightPanel.tsx`:

```tsx
"use client";

import { motion, AnimatePresence } from "framer-motion";

interface RightPanelProps {
  children: React.ReactNode;
  show: boolean;
}

const EASE_CARD = [0.22, 1, 0.36, 1] as const;

export function RightPanel({ children, show }: RightPanelProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.aside
          initial={{ x: 260, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 260, opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_CARD }}
          className="w-[260px] bg-light-surface border-l border-border-warm flex-shrink-0 overflow-y-auto hidden lg:block"
        >
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Create MobileNav component**

Create `src/components/layout/MobileNav.tsx`:

```tsx
"use client";

import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIStore } from "@/stores/ui-store";
import { Sidebar } from "./Sidebar";

export function MobileNav() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  return (
    <>
      {/* Top bar — mobile only */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-[50px] bg-page-bg border-b border-border-warm/20 flex items-center px-4">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 text-espresso"
          aria-label="Open menu"
        >
          <Menu size={22} strokeWidth={1.8} />
        </button>
        <span className="flex-1 text-center font-heading text-[18px] text-espresso tracking-heading">
          SciSpark
        </span>
        <div className="w-[38px]" /> {/* Balance spacer */}
      </div>

      {/* Slide-over sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden fixed inset-0 z-50 bg-espresso/30 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
            {/* Sidebar panel */}
            <motion.div
              initial={{ x: -210 }}
              animate={{ x: 0 }}
              exit={{ x: -210 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[210px]"
            >
              <div className="h-full relative">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="absolute top-4 right-3 p-1 text-muted-text hover:text-espresso z-10"
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
                <Sidebar />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git add src/components/layout/RightPanel.tsx src/components/layout/MobileNav.tsx
git commit -m "feat: add RightPanel and MobileNav components"
```

---

### Task 6: Build AppShell and wire into root layout

**Files:**
- Create: `src/components/layout/AppShell.tsx`
- Modify: `src/app/layout.tsx` (wrap children with AppShell)

- [ ] **Step 1: Create AppShell component**

Create `src/components/layout/AppShell.tsx`:

```tsx
"use client";

import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { RightPanel } from "./RightPanel";

interface AppShellProps {
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  showRightPanel?: boolean;
}

export function AppShell({ children, rightPanel, showRightPanel = false }: AppShellProps) {
  return (
    <div className="h-screen flex flex-col">
      {/* Mobile top bar */}
      <MobileNav />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden lg:pt-0 pt-[50px]">
        {/* Left sidebar — desktop only (mobile uses MobileNav slide-over) */}
        <div className="hidden lg:block h-full">
          <Sidebar />
        </div>

        {/* Center content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Right panel (optional, contextual) */}
        <RightPanel show={showRightPanel}>
          {rightPanel}
        </RightPanel>
      </div>
    </div>
  );
}
```

> **Note:** `showRightPanel` is `false` by default. Individual page layouts will pass `true` along with `rightPanel` content when needed (e.g., Home page with widgets, Chat page with sources panel). This wiring happens in later sub-projects.

- [ ] **Step 2: Update root layout to use AppShell**

Update `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { geistSans, geistMono, halant } from "@/lib/fonts";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "SciSpark",
  description: "AI-powered clinical evidence workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${halant.variable} antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git add src/components/layout/AppShell.tsx src/app/layout.tsx
git commit -m "feat: add AppShell layout with sidebar + center + right panel"
```

---

### Task 7: Create placeholder pages for all routes

**Files:**
- Modify: `src/app/page.tsx` (Home placeholder)
- Create: `src/app/chat/page.tsx`
- Create: `src/app/chat/[id]/page.tsx`
- Create: `src/app/library/page.tsx`
- Create: `src/app/history/page.tsx`
- Create: `src/app/profile/page.tsx`
- Create: `src/app/onboarding/page.tsx`

- [ ] **Step 1: Create Home placeholder**

Replace `src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <div className="p-7">
      <h1 className="font-heading text-[24px] text-espresso tracking-heading">
        Good evening, <span className="text-orange">Tong</span>
      </h1>
      <p className="text-[14px] text-muted-text tracking-body mt-1">
        Explore the latest research in your interests.
      </p>
      <p className="text-[14px] text-muted-text mt-8">Feed cards will go here.</p>
    </div>
  );
}
```

- [ ] **Step 2: Create New Chat placeholder**

Create `src/app/chat/page.tsx`:

```tsx
export default function NewChatPage() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="font-heading text-[40px] text-espresso tracking-heading-tight">
          SciSpark
        </h1>
        <p className="text-[14px] text-muted-text tracking-body mt-4">
          Search landing will go here.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create Chat thread placeholder**

Create `src/app/chat/[id]/page.tsx`:

```tsx
import { use } from "react";

export default function ChatThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <div className="p-7">
      <h1 className="font-heading text-[20px] text-espresso tracking-heading">
        Chat Thread
      </h1>
      <p className="text-[14px] text-muted-text tracking-body mt-2">
        Thread ID: {id} — Chat thread view will go here.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Create Library placeholder**

Create `src/app/library/page.tsx`:

```tsx
export default function LibraryPage() {
  return (
    <div className="p-7">
      <h1 className="font-heading text-[20px] text-espresso tracking-heading">
        Library
      </h1>
      <p className="text-[14px] text-muted-text tracking-body mt-2">
        Library view will go here.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Create History placeholder**

Create `src/app/history/page.tsx`:

```tsx
export default function HistoryPage() {
  return (
    <div className="p-7">
      <h1 className="font-heading text-[20px] text-espresso tracking-heading">
        History
      </h1>
      <p className="text-[14px] text-muted-text tracking-body mt-2">
        History view will go here.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Create Profile placeholder**

Create `src/app/profile/page.tsx`:

```tsx
export default function ProfilePage() {
  return (
    <div className="p-7">
      <h1 className="font-heading text-[20px] text-espresso tracking-heading">
        Profile
      </h1>
      <p className="text-[14px] text-muted-text tracking-body mt-2">
        Profile view will go here.
      </p>
    </div>
  );
}
```

- [ ] **Step 7: Create Onboarding placeholder**

Create `src/app/onboarding/page.tsx`:

```tsx
export default function OnboardingPage() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-[460px]">
        <h1 className="font-heading text-[24px] text-espresso tracking-heading">
          SciSpark
        </h1>
        <p className="text-[14px] text-muted-text tracking-body mt-4">
          Onboarding conversation will go here.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verify build and all routes work**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

Expected: Build succeeds. All routes should be accessible: `/`, `/chat`, `/chat/1`, `/library`, `/history`, `/profile`, `/onboarding`.

- [ ] **Step 9: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git add src/app/
git commit -m "feat: add placeholder pages for all routes"
```

---

### Task 8: Create shared utility components

**Files:**
- Create: `src/components/shared/GrainOverlay.tsx`
- Create: `src/components/shared/EmptyState.tsx`
- Create: `src/components/shared/SkeletonCard.tsx`
- Create: `src/components/shared/ConfirmDialog.tsx`
- Create: `src/components/shared/StarsRating.tsx`

- [ ] **Step 1: Create GrainOverlay**

Create `src/components/shared/GrainOverlay.tsx`:

```tsx
export function GrainOverlay({
  intensity = "medium",
}: {
  intensity?: "light" | "medium" | "heavy";
}) {
  const opacityClass =
    intensity === "light"
      ? "opacity-[0.12]"
      : intensity === "heavy"
        ? "opacity-[0.30]"
        : "opacity-[0.20]";

  return (
    <div
      className={`absolute inset-0 pointer-events-none ${opacityClass}`}
      style={{
        backgroundImage: "url(/textures/grain.png)",
        backgroundRepeat: "repeat",
      }}
    />
  );
}
```

- [ ] **Step 2: Copy grain texture from landing page**

```bash
mkdir -p /Users/tongshan/Documents/scispark-app-frontend/public/textures
cp /Users/tongshan/Documents/scispark-landing/public/textures/grain.png /Users/tongshan/Documents/scispark-app-frontend/public/textures/grain.png
```

- [ ] **Step 3: Create EmptyState**

Create `src/components/shared/EmptyState.tsx`:

```tsx
import Link from "next/link";

interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  actionHref?: string;
}

export function EmptyState({ message, actionLabel, actionHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[14px] text-muted-text tracking-body">{message}</p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 text-[14px] text-orange font-medium tracking-body hover:text-orange-light transition-colors"
        >
          {actionLabel} →
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create SkeletonCard**

Create `src/components/shared/SkeletonCard.tsx`:

```tsx
export function SkeletonCard() {
  return (
    <div className="bg-white rounded-card border border-border-warm overflow-hidden animate-pulse">
      <div className="h-[30px] bg-card-surface" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-card-surface rounded w-3/4" />
        <div className="h-4 bg-card-surface rounded w-1/2" />
        <div className="h-3 bg-card-surface rounded w-full" />
        <div className="h-3 bg-card-surface rounded w-2/3" />
      </div>
      <div className="px-4 pb-3 flex justify-between">
        <div className="h-3 bg-card-surface rounded w-20" />
        <div className="h-3 bg-card-surface rounded w-16" />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create StarsRating**

Create `src/components/shared/StarsRating.tsx`:

```tsx
import { Star } from "lucide-react";

interface StarsRatingProps {
  rating: number;
  max?: number;
  size?: number;
}

export function StarsRating({ rating, max = 5, size = 12 }: StarsRatingProps) {
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          size={size}
          className={
            i < rating
              ? "fill-warm-tan text-warm-tan"
              : "text-border-warm"
          }
          strokeWidth={1.6}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create ConfirmDialog**

Create `src/components/shared/ConfirmDialog.tsx`:

```tsx
"use client";

import { motion, AnimatePresence } from "framer-motion";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-espresso/30 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-card p-6 shadow-2xl max-w-sm w-full"
          >
            <h3 className="font-heading text-[18px] text-espresso tracking-heading-card">
              {title}
            </h3>
            <p className="text-[14px] text-muted-text tracking-body mt-2">
              {message}
            </p>
            <div className="flex gap-3 mt-6 justify-end">
              <button
                onClick={onCancel}
                className="px-5 py-2 text-[14px] text-muted-text rounded-pill border border-border-warm hover:bg-light-surface transition"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-5 py-2 text-[14px] text-white bg-orange rounded-pill hover:bg-orange/90 transition"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 7: Verify build**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

- [ ] **Step 8: Commit**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git add src/components/shared/ public/textures/
git commit -m "feat: add shared components (GrainOverlay, EmptyState, Skeleton, Stars, ConfirmDialog)"
```

---

### Task 9: Final verification and push

- [ ] **Step 1: Full build check**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run build
```

Expected: Clean build, no TypeScript errors.

- [ ] **Step 2: Manual smoke test**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
npm run dev
```

Verify in browser:
- `/` shows Home placeholder with sidebar
- `/chat` shows centered SciSpark text
- `/chat/1` shows chat thread placeholder
- `/library`, `/history`, `/profile` show their placeholders
- `/onboarding` shows onboarding placeholder with disabled sidebar
- Sidebar nav highlights active route
- Recent chats show in sidebar
- On mobile viewport (< 1024px), sidebar collapses and hamburger appears

- [ ] **Step 3: Push**

```bash
cd /Users/tongshan/Documents/scispark-app-frontend
git push origin main
```
