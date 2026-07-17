# SP1 — Shell & System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app feel like one designed product: grouped real-surface navigation, a theme-aware (light+dark) token system with shared UI primitives, a Claude-style settings modal, and the C1–C9 cross-cutting cleanup — per `docs/superpowers/specs/2026-07-16-sp1-shell-and-system-design.md`.

**Architecture:** Tailwind v4 `@theme inline` tokens re-pointed at semantic CSS custom properties defined per-theme on `:root` / `[data-theme="dark"]` (utility class names stay unchanged, so no app-wide class renames). New `src/components/ui/` primitives consume tokens only. Sidebar rebuilt around the spec's nav map; settings move into a modal hosted by AppShell, opened via a new ui-store field; `/settings` becomes a redirect that opens it. Cleanup items land in their owning modules with tests.

**Tech Stack:** Next.js 16 App Router, React 19.2, Tailwind v4, Zustand 5, Vitest 4 (jsdom via `// @vitest-environment jsdom` pragma), existing vault/settings API patterns.

## Global Constraints

- **Baseline stays green:** full suite (≈1413 tests), `npx tsc --noEmit`, `npm run lint` (13 pre-existing problems — add ZERO new), `npm run build`.
- **Tokens only:** no raw hex colors in `src/components/**/*.tsx` outside `src/components/viz/**` (canvas/WebGL needs literals) — enforced by a source test (Task 3).
- **Theme rule:** every SP1 surface must render correctly with `data-theme="dark"` AND without it (light default).
- **React 19.2 rule (repo law):** any `dangerouslySetInnerHTML` must receive a referentially stable wrapper object (module-level const) — see CLAUDE.md 2026-07-16 entry.
- **Browser purity:** client code never imports server-only settings loaders; new `ui` settings go through a `settings-client.ts` wrapper like companion/trending (gate test must stay green).
- **Copy rules:** no dev language on user surfaces (no raw ids, skill codenames, cost dumps); DOI/arXiv/PubMed ids may show, `openalex`/`s2` never.
- Commit after every task (conventional commits, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

### Task 1: Theme-aware token system in globals.css

**Files:**
- Modify: `src/app/globals.css:1-55` (the `@theme inline` block, `@layer base`, `::selection`)
- Test: `src/app/__tests__/theme-tokens.test.ts` (create)

**Interfaces:**
- Produces: semantic CSS vars `--bg-page --bg-warm --surface-card --surface-light --text-primary --text-secondary --text-muted --accent --accent-light --tan --border --gold`, defined for `:root` and `[data-theme="dark"]`. Tailwind utility names (`bg-page-bg`, `text-espresso`, `border-border-warm`, `bg-orange`, …) are UNCHANGED — later tasks keep using them.

- [ ] **Step 1: Write the failing test** — `src/app/__tests__/theme-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")

const SEMANTIC_VARS = [
  "--bg-page", "--bg-warm", "--surface-card", "--surface-light",
  "--text-primary", "--text-secondary", "--text-muted",
  "--accent", "--accent-light", "--tan", "--border", "--gold",
]

function block(selector: string): string {
  const start = css.indexOf(selector)
  expect(start, `selector ${selector} present`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf("}", start))
}

describe("theme tokens", () => {
  it("defines every semantic var for light (:root) and dark ([data-theme='dark'])", () => {
    const root = block(":root")
    const dark = block('[data-theme="dark"]')
    for (const v of SEMANTIC_VARS) {
      expect(root, `light ${v}`).toContain(`${v}:`)
      expect(dark, `dark ${v}`).toContain(`${v}:`)
    }
  })

  it("maps @theme colors to semantic vars instead of raw hex", () => {
    const theme = block("@theme inline")
    expect(theme).toContain("--color-page-bg: var(--bg-page)")
    expect(theme).toContain("--color-espresso: var(--text-primary)")
    expect(theme).toContain("--color-border-warm: var(--border)")
    expect(theme).not.toMatch(/--color-[a-z-]+:\s*#/)
  })

  it("body uses tokens, not hardcoded hex", () => {
    const base = css.slice(css.indexOf("@layer base"), css.indexOf("@layer utilities"))
    expect(base).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/__tests__/theme-tokens.test.ts`
Expected: FAIL (`:root` block with semantic vars not found).

- [ ] **Step 3: Rework globals.css.** Replace lines 3–50 (the `@theme inline` block and `@layer base`) with:

```css
/* Semantic theme variables — the single source of color truth.
   Light is the brand identity (cream/espresso/orange); dark derives from the
   same hues. Tailwind utility names are mapped below and never change. */
:root {
  --bg-page: #fefaf5;
  --bg-warm: #f6f0e9;
  --surface-card: #efe7dd;
  --surface-light: #faf6f2;
  --text-primary: #2b180a;
  --text-secondary: #3e2407;
  --text-muted: #94877c;
  --accent: #f97316;
  --accent-light: #fb923c;
  --tan: #dab697;
  --border: #e8d3c0;
  --gold: #fde68a;
}

[data-theme="dark"] {
  --bg-page: #161009;
  --bg-warm: #1e150c;
  --surface-card: #2b1e11;
  --surface-light: #241a10;
  --text-primary: #f4ead9;
  --text-secondary: #e6d6c0;
  --text-muted: #a09080;
  --accent: #f97316;
  --accent-light: #fb923c;
  --tan: #8a6b4f;
  --border: #3c2c1b;
  --gold: #8a7326;
}

@theme inline {
  --font-sans: var(--font-geist-sans), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-halant), Georgia, serif;
  --font-body: var(--font-geist-sans), system-ui, sans-serif;

  --color-page-bg: var(--bg-page);
  --color-page-warm: var(--bg-warm);
  --color-card-surface: var(--surface-card);
  --color-light-surface: var(--surface-light);
  --color-espresso: var(--text-primary);
  --color-secondary-dark: var(--text-secondary);
  --color-muted-text: var(--text-muted);
  --color-orange: var(--accent);
  --color-orange-light: var(--accent-light);
  --color-warm-tan: var(--tan);
  --color-border-warm: var(--border);
  --color-gold: var(--gold);

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
    background-color: var(--bg-page);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  html, body {
    height: 100%;
  }
  html[data-scroll-behavior="smooth"] {
    scroll-behavior: smooth;
  }
  ::selection {
    background-color: var(--border);
    color: var(--text-primary);
  }
}
```

Leave `@layer utilities` and everything from the `.reader-surface` comment down untouched (those rules already use `var(--color-*)`, which now resolve per-theme).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/__tests__/theme-tokens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Spot-check both themes render.** Run `npx vitest run` (full suite green), then start the dev server and in the browser console run `document.documentElement.dataset.theme = "dark"` on the home page: background must flip to deep espresso, text to cream. Remove the attribute to flip back.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/__tests__/theme-tokens.test.ts
git commit -m "feat(ui): semantic theme tokens with light + dark palettes"
```

---

### Task 2: `ui` settings (theme) — server shape, client wrapper, ThemeApplier

**Files:**
- Create: `src/lib/ui/settings.ts`, `src/lib/ui/settings-client.ts`, `src/lib/ui/__tests__/settings.test.ts`, `src/components/layout/ThemeApplier.tsx`
- Modify: `src/app/api/settings/route.ts` (add `ui` to GET response + PUT accept), `src/app/layout.tsx` (FOUC script + ThemeApplier mount)
- Test: `src/lib/ui/__tests__/settings.test.ts`

**Interfaces:**
- Produces: `type ThemeMode = "system" | "light" | "dark"`; `interface UiSettings { theme: ThemeMode }`; `DEFAULT_UI_SETTINGS`; `normalizeUiSettings(raw: unknown): UiSettings` (pure); client fns `loadUiSettingsRemote(): Promise<UiSettings>`, `saveUiSettingsRemote(ui: UiSettings): Promise<void>`; helper `applyTheme(mode: ThemeMode): void` (sets `document.documentElement.dataset.theme` and mirrors mode to `localStorage["scispark-theme"]`). Task 5's AppearanceCard consumes all of these.

- [ ] **Step 1: Write the failing normalize test** — `src/lib/ui/__tests__/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { normalizeUiSettings, DEFAULT_UI_SETTINGS } from "../settings"

describe("normalizeUiSettings", () => {
  it("defaults for garbage input", () => {
    expect(normalizeUiSettings(undefined)).toEqual(DEFAULT_UI_SETTINGS)
    expect(normalizeUiSettings(null)).toEqual(DEFAULT_UI_SETTINGS)
    expect(normalizeUiSettings({ theme: "neon" })).toEqual(DEFAULT_UI_SETTINGS)
    expect(normalizeUiSettings("dark")).toEqual(DEFAULT_UI_SETTINGS)
  })
  it("accepts the three valid modes", () => {
    expect(normalizeUiSettings({ theme: "dark" })).toEqual({ theme: "dark" })
    expect(normalizeUiSettings({ theme: "light" })).toEqual({ theme: "light" })
    expect(normalizeUiSettings({ theme: "system" })).toEqual({ theme: "system" })
  })
})
```

- [ ] **Step 2: Run it** — `npx vitest run src/lib/ui` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/ui/settings.ts`** (pure, importable everywhere):

```ts
export type ThemeMode = "system" | "light" | "dark"

export interface UiSettings {
  theme: ThemeMode
}

export const DEFAULT_UI_SETTINGS: UiSettings = { theme: "system" }

const MODES: ReadonlySet<string> = new Set(["system", "light", "dark"])

/** Tolerant normalizer for the `ui` sub-object of .scispark/settings.json —
 * mirrors normalizeCompanionSettings/normalizeTrendingSettings. */
export function normalizeUiSettings(raw: unknown): UiSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_UI_SETTINGS }
  const theme = (raw as { theme?: unknown }).theme
  return { theme: typeof theme === "string" && MODES.has(theme) ? (theme as ThemeMode) : DEFAULT_UI_SETTINGS.theme }
}
```

- [ ] **Step 4: Run it** — Expected: PASS.

- [ ] **Step 5: Extend `/api/settings`.** Read `src/app/api/settings/route.ts` fully first. Mirror EXACTLY how `companion` is handled (GET: include full sub-object; PUT: accept optional key, normalize, write within the same `withSettingsWrite` section): add `ui: normalizeUiSettings(settings.ui)` to the GET payload, and in PUT accept `body.ui`, storing `normalizeUiSettings(body.ui)` when present. Import from `@/lib/ui/settings`.

- [ ] **Step 6: Client wrapper `src/lib/ui/settings-client.ts`.** Read `src/lib/companion/settings-client.ts` first and copy its idiom (fetch wrapper, error handling) exactly, adapted to:

```ts
import { DEFAULT_UI_SETTINGS, normalizeUiSettings, type ThemeMode, type UiSettings } from "./settings"

export async function loadUiSettingsRemote(): Promise<UiSettings> {
  const res = await fetch("/api/settings")
  if (!res.ok) return { ...DEFAULT_UI_SETTINGS }
  const json = (await res.json()) as { ui?: unknown }
  return normalizeUiSettings(json.ui)
}

export async function saveUiSettingsRemote(ui: UiSettings): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ui }),
  })
  if (!res.ok) throw new Error(`saving ui settings failed: ${res.status}`)
}

/** Applies a theme mode to the document and mirrors it for the FOUC script. */
export function applyTheme(mode: ThemeMode): void {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  if (dark) document.documentElement.dataset.theme = "dark"
  else delete document.documentElement.dataset.theme
  try {
    localStorage.setItem("scispark-theme", mode)
  } catch {
    // storage unavailable (private mode) — theme still applies for this page
  }
}
```

- [ ] **Step 7: FOUC-free boot script + ThemeApplier.** In `src/app/layout.tsx`, add at MODULE level (React 19.2 stable-wrapper rule — never inline the object):

```tsx
const THEME_INIT_SCRIPT = {
  __html:
    "(function(){try{var m=localStorage.getItem('scispark-theme');var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.dataset.theme='dark'}catch(e){}})()",
}
```

and render `<script dangerouslySetInnerHTML={THEME_INIT_SCRIPT} />` as the first child of `<body>`. Create `src/components/layout/ThemeApplier.tsx`:

```tsx
"use client"

import { useEffect } from "react"
import { loadUiSettingsRemote, applyTheme } from "@/lib/ui/settings-client"

/** Syncs the persisted theme mode on mount and follows OS changes in
 * "system" mode. Renders nothing. */
export default function ThemeApplier() {
  useEffect(() => {
    let mode: "system" | "light" | "dark" = "system"
    let cancelled = false
    void loadUiSettingsRemote().then((ui) => {
      if (cancelled) return
      mode = ui.theme
      applyTheme(mode)
    })
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (mode === "system") applyTheme("system")
    }
    media.addEventListener("change", onChange)
    return () => {
      cancelled = true
      media.removeEventListener("change", onChange)
    }
  }, [])
  return null
}
```

Mount `<ThemeApplier />` inside `AppShell` (`src/components/layout/AppShell.tsx`, next to `<CompanionMascot />`).

- [ ] **Step 8: Browser-purity gate.** Read the browser-purity test (grep: `grep -rln "browser-purity\|loadCompanionSettings" src --include="*.test.ts"`). Add the same ban entries for any server-side `ui` loader IF one exists (we only added a pure normalize — confirm nothing server-only is importable from client; the pure module is fine by design).

- [ ] **Step 9: Full gates** — `npx vitest run && npx tsc --noEmit` — Expected: green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/ui src/app/api/settings/route.ts src/app/layout.tsx src/components/layout/ThemeApplier.tsx src/components/layout/AppShell.tsx
git commit -m "feat(ui): theme mode setting (system/light/dark) with FOUC-free boot"
```

---

### Task 3: UI primitives + raw-hex source guard

**Files:**
- Create: `src/components/ui/cn.ts`, `Button.tsx`, `Card.tsx`, `Chip.tsx`, `PageHeader.tsx`, `EmptyState.tsx`, `LoadingState.tsx` (all under `src/components/ui/`)
- Create: `src/components/ui/__tests__/primitives.test.tsx`, `src/components/ui/__tests__/no-raw-hex.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 4, 5, 12):
  - `cn(...parts: Array<string | false | null | undefined>): string`
  - `<Button variant?: "primary"|"secondary"|"quiet" size?: "sm"|"md" ...native button props>`
  - `<Card className?>` — token card shell (border, light surface, `rounded-card`)
  - `<Chip tone?: "neutral"|"accent" className?>` — small pill tag
  - `<PageHeader title: string description?: string actions?: ReactNode>`
  - `<EmptyState title: string hint?: string action?: ReactNode>`
  - `<LoadingState label?: string>`

- [ ] **Step 1: Failing render test** — `src/components/ui/__tests__/primitives.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../Button"
import { Card } from "../Card"
import { Chip } from "../Chip"
import { PageHeader } from "../PageHeader"
import { EmptyState } from "../EmptyState"
import { LoadingState } from "../LoadingState"

describe("ui primitives", () => {
  it("Button variants render token classes", () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain("bg-orange")
    expect(renderToStaticMarkup(<Button variant="secondary">Go</Button>)).toContain("border-border-warm")
    expect(renderToStaticMarkup(<Button variant="quiet">Go</Button>)).toContain("text-muted-text")
  })
  it("Card, Chip, PageHeader, EmptyState, LoadingState render", () => {
    expect(renderToStaticMarkup(<Card>x</Card>)).toContain("rounded-card")
    expect(renderToStaticMarkup(<Chip>tag</Chip>)).toContain("rounded-pill")
    const header = renderToStaticMarkup(<PageHeader title="Papers" description="d" actions={<span>a</span>} />)
    expect(header).toContain("Papers")
    expect(header).toContain("font-heading")
    expect(renderToStaticMarkup(<EmptyState title="Nothing yet" hint="h" />)).toContain("Nothing yet")
    expect(renderToStaticMarkup(<LoadingState label="Loading…" />)).toContain("Loading…")
  })
})
```

- [ ] **Step 2: Run** — `npx vitest run src/components/ui` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement.** `src/components/ui/cn.ts`:

```ts
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}
```

`src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react"
import { cn } from "./cn"

type Variant = "primary" | "secondary" | "quiet"
type Size = "sm" | "md"

const VARIANT: Record<Variant, string> = {
  primary: "text-white bg-orange hover:bg-orange/90 font-medium",
  secondary: "text-espresso border border-border-warm hover:bg-card-surface",
  quiet: "text-muted-text hover:text-espresso",
}
const SIZE: Record<Size, string> = {
  sm: "text-[12px] px-3 py-1",
  md: "text-[13px] px-4 py-1.5",
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("rounded-pill transition-colors disabled:opacity-50", VARIANT[variant], SIZE[size], className)}
      {...rest}
    />
  )
}
```

`src/components/ui/Card.tsx`:

```tsx
import type { HTMLAttributes } from "react"
import { cn } from "./cn"

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border-warm bg-light-surface", className)} {...rest} />
}
```

`src/components/ui/Chip.tsx`:

```tsx
import type { HTMLAttributes } from "react"
import { cn } from "./cn"

const TONE = {
  neutral: "bg-card-surface text-secondary-dark",
  accent: "bg-orange/10 text-orange",
} as const

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONE
}

export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return <span className={cn("inline-block rounded-pill px-2.5 py-0.5 text-[11px] tracking-body", TONE[tone], className)} {...rest} />
}
```

`src/components/ui/PageHeader.tsx`:

```tsx
import type { ReactNode } from "react"

export interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="font-heading text-[28px] text-espresso tracking-heading">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-muted-text tracking-body">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
```

`src/components/ui/EmptyState.tsx`:

```tsx
import type { ReactNode } from "react"

export interface EmptyStateProps {
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border border-dashed border-border-warm px-6 py-10 text-center">
      <div className="text-[14px] text-espresso">{title}</div>
      {hint && <div className="mt-1 text-[12px] text-muted-text">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
```

`src/components/ui/LoadingState.tsx`:

```tsx
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="px-1 py-6 text-[13px] text-muted-text">{label}</div>
}
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Raw-hex guard.** `src/components/ui/__tests__/no-raw-hex.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(process.cwd(), "src/components")
// Canvas/WebGL renderers can't read CSS variables — literals allowed there.
const ALLOWED = [/^viz\//]

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : tsxFiles(p)
    return p.endsWith(".tsx") ? [p] : []
  })
}

describe("no raw hex colors in components", () => {
  it("every color in src/components/**/*.tsx comes from tokens", () => {
    const offenders: string[] = []
    for (const file of tsxFiles(ROOT)) {
      const rel = relative(ROOT, file).replaceAll("\\", "/")
      if (ALLOWED.some((rx) => rx.test(rel))) continue
      const src = readFileSync(file, "utf8")
      if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/.test(src)) offenders.push(rel)
    }
    expect(offenders, `raw hex found in: ${offenders.join(", ")}`).toEqual([])
  })
})
```

- [ ] **Step 6: Run the guard.** `npx vitest run src/components/ui/__tests__/no-raw-hex.test.ts`. If it FAILS, migrate each offender to the equivalent token utility (`#f97316` → `text-orange`/`bg-orange`, `#2b180a` → `text-espresso`, `#e8d3c0` → `border-border-warm`, `#94877c` → `text-muted-text`, arbitrary one-offs → nearest token). Re-run until PASS. If an offender is genuinely canvas-bound outside `viz/`, extend `ALLOWED` with a one-line comment justifying it.

- [ ] **Step 7: Full gates** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui
git commit -m "feat(ui): shared token-driven primitives + raw-hex source guard"
```

---

### Task 4: Sidebar rebuild — grouped nav + account menu; ui-store modal state

**Files:**
- Modify: `src/stores/ui-store.ts` (add settings-modal state), `src/components/layout/Sidebar.tsx` (full rebuild of nav content)
- Test: `src/components/layout/__tests__/Sidebar.test.tsx` (create)

**Interfaces:**
- Consumes: `Chip` from Task 3 (inbox badge), existing `useUIStore`, `useUserStore` (user name), `usePathname`.
- Produces: ui-store additions `settingsModalSection: string | null`, `openSettingsModal(section?: string): void`, `closeSettingsModal(): void` (Task 5's modal + `/settings` redirect consume these). Sidebar export name/props unchanged (`Sidebar`, `{ collapsed: boolean }`). `navItems` has no external consumers (verified by grep) — safe to restructure.

- [ ] **Step 1: ui-store additions.** In `src/stores/ui-store.ts`, extend the `UIState` interface and store:

```ts
  settingsModalSection: string | null
  openSettingsModal: (section?: string) => void
  closeSettingsModal: () => void
```

```ts
  settingsModalSection: null,
  openSettingsModal: (section = "ai") => set({ settingsModalSection: section }),
  closeSettingsModal: () => set({ settingsModalSection: null }),
```

(Match the file's existing `create<UIState>()` style exactly — read it first.)

- [ ] **Step 2: Failing Sidebar test** — `src/components/layout/__tests__/Sidebar.test.tsx`. Note `next/navigation` needs mocking in vitest:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))

import { Sidebar } from "../Sidebar"

const html = () => renderToStaticMarkup(<Sidebar collapsed={false} />)

describe("Sidebar nav map (SP1)", () => {
  it("shows the grouped real-surface map", () => {
    const out = html()
    for (const label of ["Discover", "Knowledge", "Tools", "Home", "Search", "Trending", "Wiki", "Graph", "Projects", "Spark", "Chat", "History"]) {
      expect(out, label).toContain(label)
    }
    for (const href of ["/papers", "/wiki", "/viz", "/spark", "/chat", "/projects", "/trending", "/history"]) {
      expect(out, href).toContain(`href="${href}"`)
    }
  })
  it("drops the fork-era items and settings from the rail", () => {
    const out = html()
    expect(out).not.toContain("New Chat")
    expect(out).not.toContain("Library")
    expect(out).not.toContain("Recent Chats")
    expect(out).not.toContain('href="/settings"')
    expect(out).not.toContain("Dashboard")
  })
})
```

- [ ] **Step 3: Run** — Expected: FAIL (old map).

- [ ] **Step 4: Rebuild the nav content of `Sidebar.tsx`.** Read the whole file first; keep the existing shell (collapse toggle, logo, `fadeLabel` idiom, active-state logic, profile block position) and replace the flat `navItems` + "Recent Chats" section with grouped data. Structure:

```tsx
const NAV_GROUPS: Array<{ heading: string; items: Array<{ key: string; label: string; href: string; icon: LucideIcon }> }> = [
  {
    heading: "Discover",
    items: [
      { key: "home", label: "Home", href: "/", icon: Home },
      { key: "search", label: "Search", href: "/papers", icon: SearchIcon },
      { key: "trending", label: "Trending", href: "/trending", icon: TrendingUp },
    ],
  },
  {
    heading: "Knowledge",
    items: [
      { key: "wiki", label: "Wiki", href: "/wiki", icon: BookOpen },
      { key: "graph", label: "Graph", href: "/viz", icon: Network },
      { key: "projects", label: "Projects", href: "/projects", icon: FolderOpen },
    ],
  },
  {
    heading: "Tools",
    items: [
      { key: "spark", label: "Spark", href: "/spark", icon: Sparkles },
      { key: "chat", label: "Chat", href: "/chat", icon: MessageSquarePlus },
    ],
  },
]
```

Render each group with a heading (`<div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide text-muted-text">{heading}</div>`, hidden when `collapsed`), items exactly as the current item-rendering JSX. Below the groups, before the profile block: a quiet `History` link (`/history`, Clock icon, same item styling). Replace the profile `<Link href="/profile">` block with an account menu:

```tsx
const [menuOpen, setMenuOpen] = useState(false)
const menuRef = useRef<HTMLDivElement | null>(null)
const openSettingsModal = useUIStore((s) => s.openSettingsModal)

useEffect(() => {
  if (!menuOpen) return
  function onDown(e: MouseEvent) {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
  }
  document.addEventListener("mousedown", onDown)
  return () => document.removeEventListener("mousedown", onDown)
}, [menuOpen])
```

```tsx
<div ref={menuRef} className="relative">
  {menuOpen && (
    <div className="absolute bottom-full left-0 mb-2 w-48 rounded-card border border-border-warm bg-light-surface py-1 shadow-lg">
      <Link href="/profile" className="block px-4 py-2 text-[13px] text-espresso hover:bg-card-surface" onClick={() => setMenuOpen(false)}>
        Profile
      </Link>
      <button
        type="button"
        className="block w-full px-4 py-2 text-left text-[13px] text-espresso hover:bg-card-surface"
        onClick={() => {
          setMenuOpen(false)
          openSettingsModal("ai")
        }}
      >
        Settings
      </button>
    </div>
  )}
  <button type="button" onClick={() => setMenuOpen(true)} className="…existing avatar-row classes…">
    {/* existing avatar + name JSX */}
  </button>
</div>
```

Remove the recent-chats store import and section. Update lucide imports (add `Search as SearchIcon`, `BookOpen`, drop unused).

- [ ] **Step 5: Run tests** — `npx vitest run src/components/layout` — Expected: PASS. Then `npx vitest run && npx tsc --noEmit` — green (fix any unused-import lint).

- [ ] **Step 6: Browser check.** Dev server: verify groups render, collapse still works, account menu opens/closes (outside click), active states highlight, dark theme via `document.documentElement.dataset.theme="dark"` looks right.

- [ ] **Step 7: Commit**

```bash
git add src/stores/ui-store.ts src/components/layout/Sidebar.tsx src/components/layout/__tests__/Sidebar.test.tsx
git commit -m "feat(shell): grouped real-surface nav + account menu (settings modal trigger)"
```

---

### Task 5: Settings modal (Claude-style) + `/settings` redirect + profile cleanup

**Files:**
- Create: `src/components/settings/SettingsModal.tsx`, `src/components/settings/AppearanceCard.tsx`, `src/components/settings/TrendingFieldsCard.tsx`, `src/components/settings/__tests__/SettingsModal.test.tsx`
- Modify: `src/components/layout/AppShell.tsx` (mount modal), `src/app/settings/page.tsx` (redirect+open), `src/app/profile/page.tsx` (remove trending editor)

**Interfaces:**
- Consumes: ui-store `settingsModalSection`/`closeSettingsModal` (Task 4); `applyTheme`, `loadUiSettingsRemote`, `saveUiSettingsRemote`, `ThemeMode` (Task 2); existing `ConnectAiCard`, `SpendPanel`, `CompanionCard`; `loadTrendingSettingsRemote`, `saveTrendingSettingsRemote` (`src/lib/trending/settings-client.ts`), `effectiveTrackedFields`, `slugify`, `MAX_TRACKED_FIELDS` (`src/lib/trending/fields.ts`), `Cadence` (`"daily" | "weekly"`).
- Produces: modal section ids `"ai" | "spend" | "companion" | "appearance" | "trending"` (the `/settings` redirect and Sidebar use `"ai"`).

- [ ] **Step 1: Failing modal test** — `src/components/settings/__tests__/SettingsModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { useUIStore } from "@/stores/ui-store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The hosted cards fetch on mount — stub network so mounting is inert.
vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))

import SettingsModal from "../SettingsModal"

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<SettingsModal />))
  return { host, root }
}

describe("SettingsModal", () => {
  it("renders nothing when closed", () => {
    act(() => useUIStore.getState().closeSettingsModal())
    const { host } = mount()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
  it("opens on the requested section and lists all five sections", () => {
    act(() => useUIStore.getState().openSettingsModal("appearance"))
    const { host } = mount()
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    for (const label of ["Connect your AI", "Spend & budget", "Companion", "Appearance", "Trending fields"]) {
      expect(host.textContent).toContain(label)
    }
    expect(host.textContent).toContain("Theme")
  })
  it("closes via Escape", () => {
    act(() => useUIStore.getState().openSettingsModal("ai"))
    const { host } = mount()
    act(() => {
      host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(useUIStore.getState().settingsModalSection).toBeNull()
  })
})
```

- [ ] **Step 2: Run** — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `AppearanceCard.tsx`:**

```tsx
"use client"

import { useEffect, useState } from "react"
import { applyTheme, loadUiSettingsRemote, saveUiSettingsRemote } from "@/lib/ui/settings-client"
import type { ThemeMode } from "@/lib/ui/settings"
import { Button } from "@/components/ui/Button"

const MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

export function AppearanceCard() {
  const [mode, setMode] = useState<ThemeMode>("system")

  useEffect(() => {
    void loadUiSettingsRemote().then((ui) => setMode(ui.theme))
  }, [])

  async function choose(next: ThemeMode) {
    setMode(next)
    applyTheme(next)
    try {
      await saveUiSettingsRemote({ theme: next })
    } catch {
      // theme already applied locally; persistence failure is non-fatal
    }
  }

  return (
    <div>
      <h3 className="font-heading text-[16px] text-espresso tracking-heading-card">Theme</h3>
      <p className="mt-1 text-[12px] text-muted-text">How SciSpark looks on this machine.</p>
      <div className="mt-3 flex gap-2">
        {MODES.map((m) => (
          <Button key={m.value} variant={mode === m.value ? "primary" : "secondary"} onClick={() => void choose(m.value)}>
            {m.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Implement `TrendingFieldsCard.tsx`.** Read `src/app/profile/page.tsx` first and port its trending block (state around line 45+, the fields list + add/remove + cadence UI) verbatim into this card — same hooks (`loadTrendingSettingsRemote`/`saveTrendingSettingsRemote`, `effectiveTrackedFields`, `slugify`, `MAX_TRACKED_FIELDS`, `Cadence`), same JSX, wrapped in a heading ("Trending fields") consistent with AppearanceCard. Do not redesign it — this is a move.

- [ ] **Step 5: Implement `SettingsModal.tsx`:**

```tsx
"use client"

import { useMemo } from "react"
import { useUIStore } from "@/stores/ui-store"
import { ConnectAiCard } from "./ConnectAiCard"
import { CompanionCard } from "./CompanionCard"
import { SpendPanel } from "./SpendPanel"
import { AppearanceCard } from "./AppearanceCard"
import { TrendingFieldsCard } from "./TrendingFieldsCard"
import { cn } from "@/components/ui/cn"

const SECTIONS = [
  { id: "ai", label: "Connect your AI", body: <ConnectAiCard /> },
  { id: "spend", label: "Spend & budget", body: <SpendPanel /> },
  { id: "companion", label: "Companion", body: <CompanionCard /> },
  { id: "appearance", label: "Appearance", body: <AppearanceCard /> },
  { id: "trending", label: "Trending fields", body: <TrendingFieldsCard /> },
] as const

export default function SettingsModal() {
  const section = useUIStore((s) => s.settingsModalSection)
  const close = useUIStore((s) => s.closeSettingsModal)
  const open = useUIStore((s) => s.openSettingsModal)

  const active = useMemo(() => SECTIONS.find((s) => s.id === section) ?? SECTIONS[0], [section])
  if (section === null) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[min(640px,90vh)] w-[min(880px,95vw)] overflow-hidden rounded-card border border-border-warm bg-page-bg shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") close()
        }}
      >
        <nav className="w-52 shrink-0 border-r border-border-warm bg-light-surface p-3">
          <div className="px-2 pb-2 text-[11px] uppercase tracking-wide text-muted-text">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => open(s.id)}
              className={cn(
                "block w-full rounded-btn px-3 py-2 text-left text-[13px]",
                s.id === active.id ? "bg-card-surface text-espresso" : "text-secondary-dark hover:bg-card-surface/60",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-start justify-between">
            <h2 className="font-heading text-[20px] text-espresso tracking-heading-card">{active.label}</h2>
            <button type="button" onClick={close} aria-label="Close settings" className="text-muted-text hover:text-espresso">
              ✕
            </button>
          </div>
          <div className="mt-4">{active.body}</div>
        </div>
      </div>
    </div>
  )
}
```

Mount `<SettingsModal />` in `AppShell` next to `<CompanionMascot />`.

- [ ] **Step 6: `/settings` redirect.** Replace `src/app/settings/page.tsx` body with:

```tsx
"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { useUIStore } from "@/stores/ui-store"

function SettingsRedirect() {
  const router = useRouter()
  const params = useSearchParams()
  const openSettingsModal = useUIStore((s) => s.openSettingsModal)

  useEffect(() => {
    openSettingsModal(params.get("section") ?? "ai")
    router.replace("/")
  }, [openSettingsModal, params, router])

  return null
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsRedirect />
    </Suspense>
  )
}
```

(Existing in-app links to `/settings` — e.g. LlmErrorMessage affordances — now open the modal; no link rewrites needed.)

- [ ] **Step 7: Profile cleanup.** In `src/app/profile/page.tsx`, delete the trending-fields/cadence editor block and its now-unused imports (the card owns it); leave the user-model pages UI intact.

- [ ] **Step 8: Run tests + gates** — `npx vitest run src/components/settings && npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 9: Browser check.** Account menu → Settings opens modal on "Connect your AI"; all five sections switch; Esc + backdrop close; `/settings` URL redirects home with modal open; theme toggle flips instantly and persists across reload (FOUC script honors it); trending fields editable in modal; profile page no longer shows them.

- [ ] **Step 10: Commit**

```bash
git add src/components/settings src/components/layout/AppShell.tsx src/app/settings/page.tsx src/app/profile/page.tsx
git commit -m "feat(settings): Claude-style sectioned settings modal; /settings redirects into it"
```

---

### Task 6: C1 + C4 — digest cost line off, id-badge policy

**Files:**
- Modify: `src/components/papers/DigestPanel.tsx:16`, `src/components/papers/IdBadges.tsx`
- Test: `src/components/papers/__tests__/IdBadges.test.tsx` (create)

**Interfaces:** none new.

- [ ] **Step 1: Failing IdBadges test:**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { IdBadges } from "../IdBadges"

describe("IdBadges (C4: DOI yes, internal ids no)", () => {
  it("renders doi/arxiv/pmid and never openalex/s2", () => {
    const html = renderToStaticMarkup(
      <IdBadges ids={{ doi: "10.1/x", arxiv: "2409.08710", openalex: "W123", s2: "S456", pmid: "789" }} />,
    )
    expect(html).toContain("10.1/x")
    expect(html).toContain("2409.08710")
    expect(html).toContain("789")
    expect(html).not.toContain("W123")
    expect(html).not.toContain("S456")
    expect(html.toLowerCase()).not.toContain("openalex")
  })
})
```

(Read `IdBadges.tsx` first; adapt the props type in the test to its actual signature if it takes the whole record.)

- [ ] **Step 2: Run** — Expected: FAIL (openalex renders).

- [ ] **Step 3: Fix `IdBadges.tsx`:** delete the `openalex` and `s2` `entries.push` lines; keep doi/arxiv/pmid.

- [ ] **Step 4: C1 — `DigestPanel.tsx:16`:** change the meta line so cost never renders:

```tsx
{fromCache ? "from cache" : "AI digest"}
```

(Remove the now-unused `costUsd` prop threading if the compiler flags it; spend stays visible in Settings → Spend & budget.)

- [ ] **Step 5: Run** — `npx vitest run src/components/papers && npx tsc --noEmit` — green.

- [ ] **Step 6: Commit**

```bash
git add src/components/papers
git commit -m "fix(papers): drop cost line from digest meta; show DOI/arXiv/PubMed ids only (C1, C4)"
```

---

### Task 7: C7 — strip source-metadata markup from titles

**Files:**
- Create: `src/lib/papers/title.ts`, `src/lib/papers/__tests__/title.test.ts`
- Modify: `src/components/feed/RealFeedCard.tsx:58`, `src/app/papers/page.tsx:272` (+ any other `{*.title}` render in that file — grep it), reader title header in `src/components/reader/ReaderView.tsx` (grep `paper.title` inside JSX)

**Interfaces:**
- Produces: `displayTitle(title: string): string` — strips markup tags, decodes the common entities, collapses whitespace. Display-layer only (stored metadata unchanged).

- [ ] **Step 1: Failing test** — `src/lib/papers/__tests__/title.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { displayTitle } from "../title"

describe("displayTitle (C7)", () => {
  it("strips markup tags from source metadata", () => {
    expect(displayTitle("What are we <i>really</i> decoding?")).toBe("What are we really decoding?")
    expect(displayTitle("H<sub>2</sub>O and <b>bold</b>")).toBe("H2O and bold")
  })
  it("decodes common entities and collapses whitespace", () => {
    expect(displayTitle("A &amp; B  &lt;test&gt;&nbsp;C")).toBe("A & B <test> C")
  })
  it("leaves plain titles alone", () => {
    expect(displayTitle("Auditory Attention Decoding")).toBe("Auditory Attention Decoding")
  })
})
```

- [ ] **Step 2: Run** — FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/papers/title.ts`:**

```ts
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

/**
 * Source APIs (arXiv/OpenAlex/JATS) ship titles containing presentation
 * markup (<i>, <sub>, …) and entities. We render titles as plain text, so
 * strip tags and decode the common entities at the DISPLAY layer only —
 * stored metadata keeps the original string. Never renders HTML: output is
 * a plain string handed to React text children.
 */
export function displayTitle(title: string): string {
  return title
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim()
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Apply at render sites.** `grep -rn "\.title}" src/components/feed/RealFeedCard.tsx src/app/papers/page.tsx src/components/reader/ReaderView.tsx src/app/reader/page.tsx` — for each *visual* render (headings/cards — NOT logEvent payloads), wrap: `{displayTitle(paper.title)}`. Known sites: `RealFeedCard.tsx:58`, `papers/page.tsx:272` and the results-list title in the same file, the reader's `<h1>`/header title and the paywall-fallback card title.

- [ ] **Step 6: Gates** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/papers src/components/feed/RealFeedCard.tsx src/app/papers/page.tsx src/components/reader/ReaderView.tsx src/app/reader/page.tsx
git commit -m "fix(papers): strip source markup/entities from displayed titles (C7)"
```

---

### Task 8: C2 — remove the wiki "Recent ingests" log

**Files:**
- Modify: `src/app/wiki/page.tsx` (drop `listIngests`/`IngestRecord` import at :8, `ingests` state at :24, its load at :31, and the "Recent ingests" section at :119+)

**Interfaces:** none. Undo remains available via the review inbox (`applyChangeset` history untouched); per-page history returns in SP3/SP6.

- [ ] **Step 1: Delete the block.** Remove the import members, state, `listIngests(vault)` from the `Promise.all` (adjust destructuring), and the whole `<h2>Recent ingests</h2>` section's JSX.
- [ ] **Step 2: Guard against regression.** Extend the existing wiki page test if one exists (`ls src/app/wiki/__tests__ 2>/dev/null`); if none, add `src/app/wiki/__tests__/wiki-page-copy.test.ts` asserting the SOURCE no longer references the jargon:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("wiki index copy (C2)", () => {
  it("has no changeset/skill jargon on the user surface", () => {
    const src = readFileSync(join(process.cwd(), "src/app/wiki/page.tsx"), "utf8")
    expect(src).not.toContain("Recent ingests")
    expect(src).not.toContain("listIngests")
  })
})
```

- [ ] **Step 3: Gates** — `npx vitest run && npx tsc --noEmit` — green (remove any now-unused imports).
- [ ] **Step 4: Browser check** — /wiki shows type buckets + review-inbox button only.
- [ ] **Step 5: Commit**

```bash
git add src/app/wiki
git commit -m "fix(wiki): remove changeset-jargon 'Recent ingests' log from the index (C2)"
```

---

### Task 9: C3 — real deep-lint estimate in the inbox button

**Files:**
- Modify: `src/app/wiki/inbox/page.tsx` (the `"Run deep lint (~$)"` literal at :157)

**Interfaces:** consumes the existing estimate endpoint (`/api/skills/lint/estimate` — verify exact path in `src/app/api/skills/lint/` and the client helper in `src/lib/lint/client.ts`).

- [ ] **Step 1: Read first.** Read `src/app/wiki/inbox/page.tsx` around the lint handlers and `src/lib/lint/client.ts`. The deep-lint flow already fetches an estimate for its confirm dialog — find that function (grep `estimate` in both files).
- [ ] **Step 2: Fetch the estimate on mount** (same helper), store `const [deepEstimate, setDeepEstimate] = useState<number | null>(null)`, and render:

```tsx
: deepEstimate !== null
  ? `Run deep lint (~$${deepEstimate.toFixed(2)})`
  : "Run deep lint"
```

Estimate failures leave the plain label (never a bare `~$`).
- [ ] **Step 3: Test.** Follow the file's existing test setup if present; otherwise add a pure formatting helper `formatDeepLintLabel(estimate: number | null): string` in `src/lib/lint/ui-format.ts` with:

```ts
export function formatDeepLintLabel(estimate: number | null): string {
  return estimate === null ? "Run deep lint" : `Run deep lint (~$${estimate.toFixed(2)})`
}
```

and a unit test asserting both branches (`"Run deep lint"`, `"Run deep lint (~$0.02)"`); use the helper in the button.
- [ ] **Step 4: Gates + browser check** (button shows a number once loaded). 
- [ ] **Step 5: Commit**

```bash
git add src/app/wiki/inbox/page.tsx src/lib/lint
git commit -m "fix(inbox): show the real deep-lint cost estimate, never a bare ~$ (C3)"
```

---

### Task 10: C5 — canonical wiki URLs (kill the doubled /wiki/wiki/…)

**Files:**
- Create: `src/lib/wiki/href.ts`, `src/lib/wiki/__tests__/href.test.ts`
- Modify: `src/app/wiki/[...id]/page.tsx:26` (id resolution + legacy redirect), `src/components/wiki/Tree.tsx:43`, `src/app/wiki/page.tsx:78`, `src/components/reader/AskPanel.tsx` (`wikiHref`), `src/app/papers/page.tsx` (`wikiHref`), `src/components/viz/GraphView.tsx:239`, `src/components/viz/TimelineView.tsx:132`, `src/components/viz/CitationFlowView.tsx:103`, `src/components/viz/AuthorNetworkView.tsx:163`

**Interfaces:**
- Produces: `wikiHref(id: string): string` — bundle id (`wiki/methods/x` or `wiki/methods/x.md`) → canonical route `/wiki/methods/x`; and `resolveWikiRouteId(joinedParams: string): string` — URL segments → bundle id (accepts canonical AND legacy-doubled forms).

- [ ] **Step 1: Failing tests** — `src/lib/wiki/__tests__/href.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { wikiHref, resolveWikiRouteId } from "../href"

describe("wikiHref (C5)", () => {
  it("emits canonical single-wiki routes from bundle ids", () => {
    expect(wikiHref("wiki/methods/mtrf-toolbox")).toBe("/wiki/methods/mtrf-toolbox")
    expect(wikiHref("wiki/methods/mtrf-toolbox.md")).toBe("/wiki/methods/mtrf-toolbox")
    expect(wikiHref("methods/mtrf-toolbox")).toBe("/wiki/methods/mtrf-toolbox")
  })
})

describe("resolveWikiRouteId (C5)", () => {
  it("maps canonical URLs to bundle ids", () => {
    expect(resolveWikiRouteId("methods/mtrf-toolbox")).toBe("wiki/methods/mtrf-toolbox")
  })
  it("accepts legacy doubled URLs", () => {
    expect(resolveWikiRouteId("wiki/methods/mtrf-toolbox")).toBe("wiki/methods/mtrf-toolbox")
  })
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement `src/lib/wiki/href.ts`:**

```ts
/** Bundle ids are vault-relative (`wiki/methods/x`); routes omit that prefix
 * (`/wiki/methods/x`). These two helpers are the ONLY place the mapping
 * lives — every link emitter and the [...id] route go through them. */
export function wikiHref(id: string): string {
  const bare = id.replace(/\.md$/i, "").replace(/^wiki\//, "")
  return `/wiki/${bare}`
}

export function resolveWikiRouteId(joinedParams: string): string {
  const bare = joinedParams.replace(/^wiki\//, "")
  return `wiki/${bare}`
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Route resolution + legacy redirect.** In `src/app/wiki/[...id]/page.tsx`, replace the joined-id logic (around :26):

```tsx
const rawId = params?.id
const joined = Array.isArray(rawId) ? rawId.join("/") : (rawId ?? "")
const id = resolveWikiRouteId(joined)

// Legacy doubled links (/wiki/wiki/...) — settle on the canonical URL.
useEffect(() => {
  if (joined.startsWith("wiki/")) router.replace(wikiHref(id))
}, [joined, id, router])
```

(The page's lookup `bundle.pages.get(id)` now receives the `wiki/`-prefixed bundle id for BOTH URL forms.)

- [ ] **Step 6: Update every emitter.** For each listed file, route the href/push through the helper:
  - `Tree.tsx:43`: `href={wikiHref(row.id)}`
  - `wiki/page.tsx:78`: `router.push(wikiHref(path))`
  - `AskPanel.tsx` + `papers/page.tsx`: replace their local `wikiHref` definitions with `import { wikiHref } from "@/lib/wiki/href"` (delete the local copies).
  - viz views (`GraphView:239`, `TimelineView:132`, `CitationFlowView:103`, `AuthorNetworkView:163`): `router.push(wikiHref(<existing id expr>))`.
  Then verify no emitter remains: `grep -rn '"/wiki/' src --include="*.tsx" | grep -v "wiki/inbox" | grep -v href.ts` — every hit should be the helper, `/wiki` itself, or the inbox link.

- [ ] **Step 7: Gates** — full suite + tsc green.

- [ ] **Step 8: Browser check.** /wiki → click a Methods page → URL is `/wiki/methods/mtrf-toolbox` and renders; manually visiting `/wiki/wiki/methods/mtrf-toolbox` redirects to the canonical URL; graph node click lands correctly; AskPanel citation links work.

- [ ] **Step 9: Commit**

```bash
git add src/lib/wiki src/app/wiki src/components/wiki/Tree.tsx src/components/reader/AskPanel.tsx src/app/papers/page.tsx src/components/viz
git commit -m "fix(wiki): canonical /wiki/<type>/<slug> URLs everywhere; legacy doubled links redirect (C5)"
```

---

### Task 11: C6 — duplicate-author lint check + merge fix

**Files:**
- Modify: `src/lib/lint/checks.ts` (new deterministic check), `src/lib/lint/types.ts` only if the check-kind union needs a new member
- Test: extend `src/lib/lint/__tests__/checks.test.ts` (or the file's existing test home — read `src/lib/lint/__tests__/` first)

**Interfaces:**
- Consumes: the existing deterministic-check signature in `checks.ts` (every check is a pure function over the loaded bundle returning findings) — read two neighboring checks (orphans, broken wikilinks) and copy their exact shape, including how fixes are attached.
- Produces: a `duplicate-author` finding for every author name that has BOTH an OpenAlex-id-keyed page (`wiki/authors/a\d+`) and a name-slug page, with a fix that (a) rewrites all wikilinks/`related` refs from the name slug to the id slug across the bundle and (b) deletes the name-slug page — same merge semantics as `dedupeAuthorFiles` in `src/lib/skills/ingest.ts:338` (read it; reuse its normalization approach).

- [ ] **Step 1: Failing test** (adapt to the file's existing fixtures/builders — read them first; shape below assumes a `makeBundle`-style helper exists, otherwise construct pages the way sibling tests do):

```ts
it("flags an author with both an id-keyed and a name-keyed page (C6)", () => {
  const bundle = makeBundle([
    page("wiki/authors/a5074790393.md", { type: "author", title: "Edmund C. Lalor" }),
    page("wiki/authors/edmund-c-lalor.md", { type: "author", title: "Edmund C. Lalor" }),
    page("wiki/authors/a5035188059.md", { type: "author", title: "Adam Bednar" }),
  ])
  const findings = runDeterministicChecks(bundle).filter((f) => f.check === "duplicate-author")
  expect(findings).toHaveLength(1)
  expect(findings[0].summary).toContain("Edmund C. Lalor")
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement the check** in `checks.ts` following the sibling pattern: group `type: "author"` pages by normalized title (`title.toLowerCase().replace(/[.\s]+/g, " ").trim()`); a group containing an id-keyed slug (`/^a\d+$/`) AND at least one other page yields one finding per extra page. Attach the merge fix using the module's existing fix-changeset builder (fixes are recomputed at apply time per the M12 design — follow how an existing fixable check builds its changeset; the link-rewrite regex is the one in `dedupeAuthorFiles`).

- [ ] **Step 4: Run lint tests** — PASS; full gates green.

- [ ] **Step 5: Live check.** Against the running dev vault: `/wiki/inbox` → "Lint vault" → the Edmund C. Lalor duplicate is flagged; apply the fix; both wiki author lists show one Lalor; Undo restores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/lint
git commit -m "feat(lint): detect and merge duplicate author pages (C6)"
```

---

### Task 12: C8 + C9 — viz label fit, trending label truncation

**Files:**
- Modify: `src/components/viz/GraphView.tsx:173`, `src/lib/trending/fields.ts:44-63` (the truncation helper)
- Test: `src/lib/trending/__tests__/fields.test.ts` (extend — read existing cases first), `src/components/viz/__tests__/graph-label.test.ts` (create)

**Interfaces:**
- Produces: `truncateGraphLabel(title: string, max?: number): string` exported from `GraphView.tsx` (or a small `src/components/viz/labels.ts` if GraphView is client-only — prefer the separate file so the test needs no WebGL).

- [ ] **Step 1: Failing tests.** `src/components/viz/__tests__/graph-label.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { truncateGraphLabel } from "../labels"

describe("truncateGraphLabel (C8)", () => {
  it("leaves short titles alone", () => {
    expect(truncateGraphLabel("mTRF Toolbox")).toBe("mTRF Toolbox")
  })
  it("ellipsizes long titles at a word boundary", () => {
    const long = "The Multivariate Temporal Response Function (mTRF) Toolbox: A MATLAB Toolbox for Relating Neural Signals"
    const out = truncateGraphLabel(long)
    expect(out.length).toBeLessThanOrEqual(43)
    expect(out.endsWith("…")).toBe(true)
  })
})
```

And in the trending fields test file (C9):

```ts
it("never leaves a dangling open-paren fragment and marks truncation (C9)", () => {
  const label = "auditory attention decoding (EEG-based cocktail party paradigms and beyond)"
  const out = truncateFieldLabel(label)   // use the module's actual exported name — read fields.ts:44
  expect(out).not.toMatch(/\([^)]*$/)
  expect(out.endsWith("…")).toBe(true)
})
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** `src/components/viz/labels.ts`:

```ts
const MAX_GRAPH_LABEL = 42

export function truncateGraphLabel(title: string, max: number = MAX_GRAPH_LABEL): string {
  if (title.length <= max) return title
  const cut = title.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`
}
```

Use it at `GraphView.tsx:173`: `label: truncateGraphLabel(node.title),`. For C9, patch the existing helper at `fields.ts:44-63`: after the word-boundary cut, strip any dangling fragment (`.replace(/\s*\([^)]*$/, "")`) and append `…` when the result is shorter than the input.

- [ ] **Step 4: Run** — PASS; full gates green.
- [ ] **Step 5: Browser check** — graph labels no longer collide/overflow at the default zoom; trending header shows "auditory attention decoding…" (no bare paren).
- [ ] **Step 6: Commit**

```bash
git add src/components/viz src/lib/trending
git commit -m "fix(viz,trending): ellipsize graph node labels and field titles cleanly (C8, C9)"
```

---

### Task 13: Primitives adoption pass (mechanical restyle)

**Files:**
- Modify: `src/app/papers/page.tsx`, `src/app/wiki/page.tsx`, `src/app/wiki/inbox/page.tsx`, `src/app/trending/page.tsx`, `src/app/spark/page.tsx`, `src/app/viz/page.tsx`, `src/app/profile/page.tsx`

**Interfaces:** consumes Task 3 primitives. NO layout redesigns — same structure, shared components. (Deep redesigns are SP2/SP3/SP4.)

- [ ] **Step 1: Worked example — papers page.** Replace the hand-rolled header with:

```tsx
<PageHeader
  title="Papers"
  actions={<Link href="/wiki/inbox" className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1">Review inbox</Link>}
/>
```

and each hand-rolled `text-[13px] text-white bg-orange … rounded-pill` button with `<Button>` / `<Button variant="secondary">` keeping the same labels/handlers.

- [ ] **Step 2: Apply the same recipe per page.** For each file: page title block → `PageHeader` (title + existing description line + existing action buttons as `actions`); repeated pill-button classes → `Button` variants; bare "None yet"/"No ideas yet" blocks → `EmptyState` (title = existing copy); "Loading…" divs → `LoadingState`; ad-hoc tag pills → `Chip`. Rule: if a substitution would change behavior or layout beyond the visual shell, skip it (leave a `// SP2:`-style breadcrumb comment only when the file already carries such notes — otherwise nothing).

- [ ] **Step 3: Gates** — full suite + tsc + lint green (imports pruned).

- [ ] **Step 4: Browser sweep both themes.** Walk /, /papers, /wiki, /wiki/inbox, /trending, /spark, /viz, /profile in light AND dark (`applyTheme` via the modal). Verify: no visual regressions, consistent headers/buttons/chips, dark theme has no unreadable patches (tune `[data-theme="dark"]` values in globals.css if any component reads poorly — values are the single tuning point).

- [ ] **Step 5: Commit**

```bash
git add src/app src/components
git commit -m "refactor(ui): adopt shared primitives across real surfaces (mechanical)"
```

---

### Task 14: Final gates, live verification with Tong, ledger, PR

**Files:**
- Modify: `CLAUDE.md` (status ledger), `docs/superpowers/specs/2026-07-16-sp1-shell-and-system-design.md` (Status → Built)

- [ ] **Step 1: Full gates.** `npx vitest run && npx tsc --noEmit && npm run lint && npm run build` — all green, zero new lint problems.
- [ ] **Step 2: Browser verification checklist** (drive it, then hand Tong the same list):
  - Sidebar: Discover/Knowledge/Tools groups; Search/Wiki/Graph present; no New Chat/Library/Dashboard/Recent Chats; History quiet at bottom; account menu → Profile / Settings.
  - Settings modal: five sections; theme toggle live-switches and survives reload; trending fields editable; `/settings` deep link opens it.
  - Dark mode: every real surface readable; reader + highlights still correct in both themes.
  - C1–C9: each verified per its task's browser check (cost line gone, DOI-only chips, clean titles, no Recent ingests, real lint estimate, canonical wiki URLs + legacy redirect, Lalor dedup via lint, graph labels fit, trending title clean).
- [ ] **Step 3: Update docs.** Spec header `**Status:** Built (SP1)`; CLAUDE.md in-flight entry → shipped entry (one sentence per SP1 area + "SP2 next"), per the repo's ledger style.
- [ ] **Step 4: Commit + push + PR.**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-16-sp1-shell-and-system-design.md
git commit -m "docs: SP1 shipped — ledger + spec status"
git push -u origin uiux/sp1-shell-system
gh pr create --base main --title "feat(ui): SP1 Shell & System — nav map, theme system, settings modal, C1-C9 cleanup" --body "<summary per repo PR style, list the 14 tasks, test counts, verification notes>"
```

---

## Self-review notes (run before execution)

- **Spec coverage:** §1 nav → Task 4; §2 tokens/primitives/hex-guard → Tasks 1–3, 13; §3 modal/redirect/profile → Task 5 (+ ui setting Task 2); §4 C1→T6, C2→T8, C3→T9, C4→T6, C5→T10, C6→T11, C7→T7, C8/C9→T12; §6 testing → per-task tests + Task 14 gates. No gaps found.
- **Read-first steps** exist wherever the plan relies on code not fully quoted here (settings route, profile trending block, inbox lint handlers, lint check shape, ui-store style). Implementers must do those reads — signatures there are authoritative over this plan's sketches.
- **Type consistency check:** `wikiHref`/`resolveWikiRouteId` (T10) used consistently; `applyTheme`/`ThemeMode` (T2) consumed in T5; primitives' props (T3) consumed in T4/T5/T13 as defined.
