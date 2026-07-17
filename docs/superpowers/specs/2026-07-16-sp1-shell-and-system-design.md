# SP1 — Shell & System (UI/UX redesign, part 1 of 6)

**Date:** 2026-07-16
**Status:** Built (SP1) — 2026-07-17, branch `uiux/sp1-shell-system`, 1465 tests green, whole-branch review READY
**Origin:** Tong's live walk-through of the app (2026-07-16) + Claude's full-surface audit.
Full raw punch-list: session scratchpad `uiux-audit.md`; the durable subset is folded in here
and into the SP2–SP6 scopes below.

## Context: the six-part redesign

Tong's verdict after hand-driving the app: the current experience "doesn't make any sense" as
a whole — the sidebar navigates to fork-era mock pages while hiding the real product, the
discover→read→digest→save journey has no coherent spine, and the visual language predates the
product's identity. Direction chosen: **coherence + visual refresh** (not a ground-up product
rethink), decomposed into six sequenced sub-projects, each with its own spec → plan → build:

| SP | Scope | Status |
|----|-------|--------|
| **SP1 (this spec)** | Navigation map, theme-aware visual system, settings modal, cross-cutting cleanup | Drafted |
| SP2 | Core paper loop: unified paper page, three-tier save model, feed card redesign | Next |
| SP3 | Knowledge home: wiki dashboard redesign + Litmaps-style visualization workspace | Queued |
| SP4 | Trending redesign: broader "academia right now" fields + visual overhaul (incl. its backend/field-selection component) | Queued |
| SP5 | KB Chat (real, replacing mock) | Queued |
| SP6 | Projects + History (real, replacing mocks) | Queued |

Decisions that shape later SPs but were settled during this brainstorm (recorded here so they
aren't lost; their specs will detail them):

- **Unified paper flow (SP2):** feed cards and search results are the same object with the same
  destination — one canonical paper detail page (rich explanation, `AI digest` / `Add to
  knowledge base` actions, ask-AI-about-this-paper at the bottom).
- **Three-tier save model (SP2):** Save = instant free metadata+abstract stub page in the wiki →
  automatic background light-AI pass over abstract+metadata (~$0.001–0.01: tags, TL;DR, links
  into existing wiki) → explicit "Add to knowledge base" full-text ingest (~$0.10–0.30).
  **There is no separate Library: the wiki's Papers section IS the library**, with
  "saved (light)" vs "fully processed" shelves on the wiki dashboard.
- **Feed card language (SP2):** Apple-News-style instant scan — headline + AI TL;DR + small
  instant-read tags (the old landing-page card is the visual reference); no prose walls; whole
  card clickable; relevance score chip either humanized or dropped.
- **Feed freshness (backend, split out):** recommendation funnel needs a recency signal
  (verified: today's cache spans 2016–2025); explicitly NOT part of the UI/UX effort.
- **Wiki dashboard (SP3):** /wiki becomes the researcher's knowledge-base dashboard. The
  "Recent ingests" changeset log leaves the front page (jargon, confusing). Undo stays
  available (review inbox now; per-page history and/or History tab later). Every wiki item
  editable + deletable from its page, consistently.
- **Graph (SP3):** keep all four views (graph / timeline / citations / authors) but redesign as
  a visualization workspace where the user chooses the lens (Litmaps-inspired); graph view
  itself should reach Obsidian-grade visual quality.
- **Ask-anywhere (SP2+):** highlight-to-ask extends beyond the reader to digests/paper pages
  (vision: wiki pages too).
- **Companion:** stays as the floating mascot + bubbles, restyled only to match the new tokens.

## SP1 goal

After SP1 ships, the app should *feel like one designed product* even though the deep rebuilds
(SP2–SP6) haven't landed: the sidebar tells the product's true story, every page wears the same
refreshed visual system (light AND dark), settings behave like a modern AI-native app, and no
user-facing surface leaks developer language.

Non-goals for SP1: feed card, paper page, digest, reader flow changes (SP2); wiki dashboard and
viz redesign (SP3); trending content/visuals (SP4); making Chat/Projects/History real (SP5/6).
Mock pages stay reachable with their current content until their SP lands — SP1 restyles their
shells (shared primitives) but does not rebuild them.

## 1. Navigation map

New sidebar (component: `src/components/layout/Sidebar.tsx`), grouped with light section
headers that teach the product's mental model:

```
Discover
  Home        /              (feed)
  Search      /papers        (renamed from "Papers")
  Trending    /trending

Knowledge
  Wiki        /wiki          (+ review-inbox count badge)
  Graph       /viz           (renamed from "Dashboard")
  Projects    /projects      (mock until SP6)

Tools
  Spark       /spark
  Chat        /chat          (mock until SP5)

Bottom block
  History     /history       (mock until SP6, quiet placement above profile)
  [Profile/account block]    → popover menu: Profile (/profile), Settings (opens modal)
```

Removed from the rail: **New Chat, Library, Settings** as top-level items, and the
"Recent Chats" sidebar section (mock data; returns for real in SP5).
- Library: dissolved permanently (see save model above).
- Projects: keeps its slot (Tong's call: mock pages stay reachable from nav until their SP);
  page content is rebuilt in SP6.
- Settings: moves into the profile menu as a modal (§3).
- New Chat → single "Chat" entry under Tools (page itself stays mock until SP5).

Active-state, collapsed-rail behavior, and inbox badge semantics stay as today unless the
visual system (§2) restyles them.

## 2. Theme-aware visual system

**Tokens.** Codify the brand palette as CSS-variable design tokens with **light and dark**
values from day one (Tong's call: build theme-aware now, no retrofit). Light theme is the
current identity: cream `#fefaf5` background, espresso `#2b180a` text, orange `#f97316`
accent, Halant serif headings + Geist body, 28px card radii, warm borders. Dark theme derives
from the same hues (deep espresso surfaces, cream text, same orange accent) — tuned by eye
during build, contrast-checked (WCAG AA for text tokens). Theme selection: system preference
by default + manual toggle in Settings; persisted in `.scispark/settings.json` (a `ui`
sub-object via `/api/settings`, following the companion/trending settings pattern).

**Primitives.** Extract the repeated Tailwind idioms into shared components used app-wide:
`Card`, `Chip/Tag`, `Button` (primary/secondary/quiet), `PageHeader` (title + actions row),
`EmptyState` (icon + one-liner + optional action), `LoadingState`. Pages adopt them in SP1
mechanically (same layout, new primitives) — deep per-page redesigns wait for their SP. All
primitives consume tokens only (no raw hex in components), so dark mode is automatic.

**Litmus test.** Every page — including still-mock ones — renders correctly in both themes
with no raw-hex stragglers (a source check bans hex literals in `src/components/**` outside
the token file).

## 3. Settings modal (Claude-style)

The bottom-of-sidebar profile block becomes an account menu (avatar + name → popover):
**Profile** (routes to /profile) and **Settings** (opens a modal overlay, no route change —
Claude Code's settings pattern per Tong's screenshots). Modal contents, sectioned with a left
rail inside the modal:

- **Connect your AI** — the existing provider presets / BYOK card, moved from /settings.
- **Spend & budget** — the AI-spend panel (today bar, 7-day chart, per-skill table, budget
  editor), moved from /settings — this also completes the M12 deferred item "relocate the
  spend panel to a user-facing settings surface".
- **Companion** — name + chattiness (from /settings).
- **Appearance** — NEW: theme (system/light/dark).
- **Trending fields** — the fields + cadence editor currently on /profile (it's configuration,
  not identity; /profile keeps the user-model pages, which ARE identity).

The `/settings` route redirects to home and opens the modal (deep-linkable via query param,
e.g. `/?settings=ai`), so old links keep working. `/debug/llm` stays as the dev harness,
untouched.

## 4. Cross-cutting cleanup (ship-with-SP1 fixes)

Dev-language leaks:
- C1. Digest cost line ("COST: $0.0349") — remove from user surface (spend lives in Settings).
- C2. Wiki "Recent ingests" front-page changeset log — removed with the /wiki header pass in
  SP1 (full dashboard redesign is SP3): skill codenames (`reading-companion`,
  `memory-consolidation`) and raw changeset ids (`cs-1784…`) must not appear on user surfaces.
  Undo remains available via the review inbox in the interim.
- C3. Inbox "Run deep lint (~$)" — interpolate the real estimate ("~$0.02") or drop the number.

Provenance rule:
- C4. Show DOI chips; never show raw `openalex`/internal IDs on user surfaces (papers, reader,
  paper cards). Applies app-wide.

Bugs (all verified live during the audit):
- C5. Wiki deep-link routing: natural URLs (`/wiki/methods/x`) 404 while internal links double
  the segment (`/wiki/wiki/methods/x`). Fix so BOTH the natural form and existing internal
  links resolve (redirect or accept the doubled form), and emit canonical single-`wiki` hrefs.
- C6. Duplicate author pages (e.g. "Edmund C. Lalor" as `authors/a5074790393` AND
  `authors/edmund-c-lalor`): dedupe existing pages via a lint-style fix and prevent new ones
  (ingest author-page keying rule: prefer OpenAlex ID when known, one page per author).
- C7. Raw HTML in titles (`<i>really</i>` rendered literally on /papers and /reader): strip or
  render source-metadata markup safely (sanitized subset) at the display layer.
- C8. Viz node labels overflow the canvas and overlap; some nodes unlabeled — fit labels to
  canvas, declutter (full viz redesign remains SP3).
- C9. Trending field title truncates mid-word ("auditory attention decoding (EEG") — fix
  truncation to ellipsize properly (content/scope redesign remains SP4).

## 5. Architecture & files (expected shape)

- `src/app/globals.css` — token definitions (light + dark blocks), replacing scattered values.
- `src/components/ui/` — NEW: `Card.tsx`, `Chip.tsx`, `Button.tsx`, `PageHeader.tsx`,
  `EmptyState.tsx`, `LoadingState.tsx` (client-safe, token-driven, no server imports).
- `src/components/layout/Sidebar.tsx` — new grouped nav + account menu popover.
- `src/components/settings/SettingsModal.tsx` — NEW: sectioned modal; hosts the existing
  Connect-your-AI, spend panel, companion settings components (moved, not rewritten), plus the
  new Appearance section; trending-fields editor moves in from /profile.
- `/api/settings` — extend the settings shape with a `ui` sub-object (`theme`), same
  normalize/PUT-patch pattern as companion/trending settings; browser access via a
  `ui/settings-client.ts` wrapper (browser-purity gate compliant).
- Route adjustments: `/settings` → redirect + modal open; `/profile` keeps user-model pages.
- Cleanup fixes land in their owning modules (wiki route handling, ingest author keying +
  one-time dedupe migration/lint fix, title sanitizer, feed/paper card chip rules).

## 6. Testing

- Unit: token file exists & both themes define the same variable set; primitives render;
  sidebar nav map (labels/hrefs/grouping/no-mock-top-level) asserted; settings modal sections
  render and route-redirect works; wiki URL canonicalization (natural + doubled forms
  resolve, emitted hrefs canonical); title-markup stripping; author-key rule.
- Existing suites keep passing (≈1400 tests green baseline).
- Browser hand-check (with Tong): both themes across every real surface; settings modal flows;
  nav walk; the C1–C9 fixes visually confirmed.

## 7. Open questions

None blocking. Deferred-by-design: dark-theme exact values tuned during build; per-page deep
redesigns (SP2–SP6).
