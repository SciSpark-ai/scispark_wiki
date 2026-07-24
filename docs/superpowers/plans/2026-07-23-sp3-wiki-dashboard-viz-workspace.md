# SP3 — Wiki Dashboard + Viz Workspace Implementation Plan

**Status (2026-07-24):** Built — all 11 tasks complete, 1708 tests green, tsc clean, lint at the pre-existing 8/5 baseline, build compiles, whole-branch review READY TO MERGE, live hand-driven against a real vault. Correction to the Architecture note below: deletes do NOT appear in any in-app undo surface — the changeset is recoverable on disk (revert route / `listIngests`) but has no one-click UI undo; the review inbox shows only lint/generation items. Deferred to SP6 (History). Final-gate fixes beyond the 11 tasks: full-height graph canvas (was fixed 560px), honest delete copy, wikilink-stripped dashboard tldr, non-navigating lens captions, LoadingState (not dev-language "coming soon") for citations-null.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/wiki` becomes a stats + shelves + sections dashboard (tree behind "Browse all", consistent Edit/Delete page actions with undoable deletes), and `/viz` becomes a full-height Litmaps-style workspace: four lenses over one shared filtered subset, cross-lens selection, node inspector, Obsidian-grade graph.

**Architecture:** Everything stays pure-derivation over the existing `Bundle` (`loadBundle(vault)` → `useMemo`) — no new endpoints, no stored view state, zero LLM. Two new pure libs (`deriveWikiDashboard`, `filterBundle`) carry all logic and all unit tests; components are thin consumers. Delete is an atomic changeset (client-built, applied via the existing `/api/vault/changeset` route) followed by the same `writeIndex` + `appendLog` sequence `undoIngest` uses, so deletes appear in the existing undo surface automatically.

**Tech Stack:** Next.js 16 App Router (all-client pages, existing pattern), Tailwind v4 tokens from SP1, Sigma.js + graphology (graph lens), vitest + `react-dom/server` for component tests.

**Spec:** `docs/superpowers/specs/2026-07-23-sp3-wiki-dashboard-viz-workspace-design.md`

## Global Constraints

- Zero LLM calls anywhere in SP3; zero new API routes; nothing persisted for either surface (no caches, no view state).
- All colors/typography via SP1 semantic tokens — the no-raw-hex source guard and browser-purity test must stay green.
- No dev-language on user surfaces: no changeset ids, no skill codenames (SP1 rule).
- All titles render through `displayTitle` (`src/lib/papers/title.ts`); all wiki links through `wikiHref` (`src/lib/wiki/href.ts`).
- Paper entries route to `/paper/<slug>` (slug = last path segment of the wiki id) everywhere on `/wiki` surfaces: shelves, type sections, recent strip, Browse-all tree.
- `npm run lint` must add no new errors/warnings over the 8/5 baseline; full suite green before every commit.
- New `dangerouslySetInnerHTML` is banned unless the wrapper object is referentially stable (React 19.2 gotcha — see CLAUDE.md); no side effects inside JSX expressions.

---

### Task 1: `deriveWikiDashboard` pure lib

**Files:**
- Create: `src/lib/wiki/dashboard.ts`
- Test: `src/lib/wiki/__tests__/dashboard.test.ts`

**Interfaces:**
- Consumes: `Bundle`, `WikiPage` (`src/lib/vault/bundle.ts`, `src/lib/vault/types.ts`).
- Produces (later tasks rely on these exact names):

```ts
export type PaperShelfStatus = "saved" | "enriched" | "ingested"
export interface ShelfEntry {
  id: string            // bundle id, e.g. "wiki/papers/arxiv-2409-08710"
  slug: string          // last segment, for /paper/<slug>
  title: string         // raw frontmatter title (caller renders via displayTitle)
  tags: string[]
  status: PaperShelfStatus
  tldr: string | null   // frontmatter.tldr, else first body text line, else null
  updated: string
}
export interface SectionEntry { id: string; title: string; updated: string; status?: string; depth?: string }
export interface DashboardSection { type: string; label: string; entries: SectionEntry[]; total: number }
export interface RecentEntry { id: string; title: string; type: string; updated: string }
export interface WikiStats {
  papers: { saved: number; enriched: number; ingested: number; total: number }
  knowledge: number   // concept+method+finding+comparison+topic
  ideas: number
  notes: number
}
export interface WikiDashboard {
  stats: WikiStats
  shelves: Record<PaperShelfStatus, ShelfEntry[]>
  sections: DashboardSection[]   // empty sections omitted
  recent: RecentEntry[]
}
export function deriveWikiDashboard(
  bundle: Bundle,
  opts?: { shelfLimit?: number; sectionLimit?: number; recentLimit?: number },
): WikiDashboard
```

Rules to implement: papers are `frontmatter.type === "paper"`; a paper whose `status` is missing or unrecognized counts as `saved` (oldest tier — never hide a paper). Shelves/sections/recent all sort by `updated` desc, tie-break by id asc; limits default `shelfLimit: 12`, `sectionLimit: 6`, `recentLimit: 10` (shelf arrays are capped at `shelfLimit` — Task 3's "View all" fetches the full list itself via a second `deriveWikiDashboard` call with `shelfLimit: Infinity`). Section order is fixed: concept, method, finding, comparison, topic, idea, note, author (labels "Concepts", "Methods", "Findings", "Comparisons", "Topics", "Ideas", "Notes", "Authors"); `total` is the uncapped count. `tldr` fallback: first body line that is non-empty after trimming and doesn't start with `#`. Recent covers ALL pages (papers included), excluding nothing.

- [ ] **Step 1: Write failing tests** — cover: per-status paper counts (including missing-status → saved); knowledge stat sums the five types; shelf sorting + cap + tie-break; tldr from frontmatter, tldr fallback from body, null when body is only headings; empty sections omitted; section `total` vs capped `entries`; recent ordering across types; idea entries carry `status`/`depth` from frontmatter. Build bundles with the test-helper pattern used in `src/lib/viz/__tests__/graph.test.ts` (in-memory pages Map).
- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/wiki/__tests__/dashboard.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/wiki/dashboard.ts`** — single pass over `bundle.pages.values()`, bucket by type, then sort/slice. No I/O, no Date.now.
- [ ] **Step 4: Run to verify pass**, then full suite `npx vitest run`.
- [ ] **Step 5: Commit** — `feat(wiki): deriveWikiDashboard pure derivation for the dashboard`

### Task 2: Dashboard components (StatsStrip, Shelf, TypeSections, RecentStrip)

**Files:**
- Create: `src/components/wiki/dashboard/StatsStrip.tsx`, `Shelf.tsx`, `TypeSections.tsx`, `RecentStrip.tsx`
- Test: `src/components/wiki/dashboard/__tests__/dashboard-components.test.tsx`

**Interfaces:**
- Consumes: Task 1 types. `displayTitle`, `wikiHref`, SP1 primitives (`Card`, `Chip`, `EmptyState` from `src/components/ui/`).
- Produces:
  - `StatsStrip({ stats, inboxCount }: { stats: WikiStats; inboxCount: number })` — 5 cards; inbox card is a `Link` to `/wiki/inbox`.
  - `Shelf({ label, entries, total, onViewAll }: { label: string; entries: ShelfEntry[]; total: number; onViewAll: () => void })` — horizontal scroll row (`overflow-x-auto flex gap-3`); each card: `displayTitle(title)`, two-line-clamped tldr (`line-clamp-2`), up to 3 tag `Chip`s, status badge; whole card `Link` to `/paper/${slug}`; trailing "View all (N)" button when `total > entries.length`.
  - `TypeSections({ sections }: { sections: DashboardSection[] })` — grid of section cards; entries link via `wikiHref(id)`; idea entries show `status`/`depth` badges (reuse the badge rendering pattern from the wiki Tree's idea badges); "All →" links to the Browse-all view (`/wiki?view=all`).
  - `RecentStrip({ recent }: { recent: RecentEntry[] })` — list of "Updated {displayTitle(title)}" rows linking via `wikiHref` (papers → `/paper/<slug>`), with the date. No changeset ids, no skill names.
- All components are presentation-only (props in, no vault access) — testable with `renderToStaticMarkup`.

- [ ] **Step 1: Write failing component tests** — `renderToStaticMarkup` assertions: stats numbers appear; shelf card renders clamped tldr text + `/paper/<slug>` href + status badge; empty-entries `Shelf` renders nothing; `TypeSections` renders idea badges; `RecentStrip` paper rows link to `/paper/<slug>` and non-paper rows to `wikiHref`.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement the four components** (token classes only — mirror `src/components/ui/Card.tsx` conventions).
- [ ] **Step 4: Run tests + full suite.**
- [ ] **Step 5: Commit** — `feat(wiki): dashboard presentation components`

### Task 3: Rebuild `/wiki` page — dashboard + Browse all toggle + paper routing

**Files:**
- Modify: `src/app/wiki/page.tsx`, `src/components/wiki/Tree.tsx`
- Test: `src/app/wiki/__tests__/wiki-dashboard-page.test.tsx` (new), extend `src/components/wiki/__tests__/Tree.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–2; existing `loadBundle`, `reviewCount`, `composePage` (New note stays as-is).
- Produces: `/wiki` renders dashboard by default; `?view=all` (and a header segmented toggle "Dashboard | All pages") renders the existing `Tree`. `Tree` gains paper routing: entries whose page `frontmatter.type === "paper"` link to `/paper/<slug>` instead of `wikiHref` (implemented inside `Tree.tsx` so the inbox/backlinks surfaces that also use `wikiHref` stay untouched).

- [ ] **Step 1: Failing tests** — page test (mock vault/bundle): dashboard sections render on default view; `view=all` renders the tree; header keeps "New note" + inbox count. Tree test: paper node href is `/paper/<slug>`, concept node href unchanged.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** — `useSearchParams` for `view`; `deriveWikiDashboard` in `useMemo`; "View all" on a shelf switches to a full-list state (re-derive with `shelfLimit: Infinity`, render that shelf as a vertical grid). Empty-vault → `EmptyState` with "Search for papers →" linking `/papers`.
- [ ] **Step 4: Run tests + full suite.**
- [ ] **Step 5: Commit** — `feat(wiki): /wiki dashboard with Browse-all toggle, papers route to /paper/[key]`

### Task 4: Delete machinery (pure lib + client flow)

**Files:**
- Create: `src/lib/wiki/delete.ts`
- Test: `src/lib/wiki/__tests__/delete.test.ts`

**Interfaces:**
- Consumes: `Changeset`/`FileChange` types, `makeChangesetId`, `applyChangeset`, `loadChangeset` (`src/lib/vault/changesets.ts`), `writeIndex`, `appendLog` (`src/lib/vault/index-builder.ts`), `loadBundle`, `RESERVED_FILES`.
- Produces:

```ts
export const PROTECTED_PAGE_IDS = ["profile", "interests", "feedback"] as const  // user-model pages, wiki-root ids
export function isDeletablePage(page: WikiPage): boolean
// false for RESERVED_FILES basenames and PROTECTED_PAGE_IDS (+ their wiki/ prefixed forms)
export function backlinkCount(bundle: Bundle, id: string): number
// count of links.from pages (deduped by from-id) with to === id
export async function deletePage(storage: VaultStorage, page: WikiPage): Promise<string>
// reads raw content, builds a one-change changeset {skill: "delete", model: "none",
// changes: [{path, before: raw, after: null}]}, writes `.scispark/changesets/<id>.json`,
// applies it, rebuilds index (writeIndex over a fresh loadBundle), appends a log entry
// {op: "delete", summary: page.id}; returns the changeset id.
```

Undo needs no new code: the changeset JSON in `.scispark/changesets/` makes it appear in `listIngests`, and the existing revert path (`undoIngest` / the generic revert route) restores the file and rebuilds the index.

- [ ] **Step 1: Failing tests** (MemoryVaultStorage): `isDeletablePage` false for `index`/`schema`/`profile` etc., true for a concept; `backlinkCount` dedupes multiple links from one page; `deletePage` removes the file, writes the changeset record, rebuilds `index.md` without the page, appends the log line; `undoIngest(storage, id)` after `deletePage` restores the file byte-identical and re-lists it in `index.md`.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement.** Note `appendLog`'s existing signature (`{date, op, summary}` — check `src/lib/vault/index-builder.ts:32` before writing).
- [ ] **Step 4: Run tests + full suite.**
- [ ] **Step 5: Commit** — `feat(wiki): undoable page deletion as a changeset`

### Task 5: Wiki page action row (Edit / Delete / Open paper page)

**Files:**
- Modify: `src/app/wiki/[...id]/page.tsx`
- Create: `src/components/wiki/DeleteConfirmCard.tsx`
- Test: `src/components/wiki/__tests__/DeleteConfirmCard.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`isDeletablePage`, `backlinkCount`, `deletePage`).
- Produces: a consistent action row under the page header: Edit (existing editor affordance, unchanged), **Delete** (only when `isDeletablePage`), and for `type === "paper"` an "Open paper page →" link to `/paper/<slug>`. `DeleteConfirmCard({ title, backlinks, busy, error, onConfirm, onCancel })` — inline card (NOT `window.confirm` — embedded-webview rule from the CaptureIdeaCard fix), shows "N pages link here" when `backlinks > 0`, surfaces `error` inline, Esc cancels.

- [ ] **Step 1: Failing tests** — card renders backlink line ("3 pages link here"), hides it at 0; error prop renders; confirm disabled while `busy`.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** — on confirm: `deletePage` → `router.push("/wiki")`; failures set the card's `error`, never swallowed. Delete button absent on protected pages and on pages of type `paper` with `status: ingested`? — No: ingested papers are deletable like everything else (undo exists); only reserved/user-model pages are excluded.
- [ ] **Step 4: Run tests + full suite.**
- [ ] **Step 5: Commit** — `feat(wiki): consistent page action row with undoable delete`

### Task 6: `filterBundle` pure lib

**Files:**
- Create: `src/lib/viz/filter.ts`
- Test: `src/lib/viz/__tests__/filter.test.ts`

**Interfaces:**
- Consumes: `Bundle`.
- Produces:

```ts
export interface VizFilters {
  types: string[]           // empty = all types
  tags: string[]            // empty = all; match = page has ANY selected tag
  yearRange: { min: number | null; max: number | null }  // applies only to pages with a derivable year
}
export const EMPTY_FILTERS: VizFilters   // { types: [], tags: [], yearRange: {min: null, max: null} }
export function isEmptyFilters(f: VizFilters): boolean
export function pageYear(page: WikiPage): number | null
// frontmatter.year if number, else leading 4 digits of `created`, else null
// (same convention as deriveTimeline / VizPage.paperYear — extract, don't duplicate)
export function filterBundle(bundle: Bundle, filters: VizFilters): Bundle
// returns a NEW Bundle: pages passing all three predicates; links where both
// endpoints survive; errors passed through unchanged. Empty filters returns
// the input bundle by reference (identity — preserves useMemo downstream).
```

Year rule: pages with `pageYear === null` (concepts, methods…) are unaffected by `yearRange` — the range constrains only dated pages. `filterOptions(bundle)` also exported: `{ types: string[], tags: string[], yearBounds: {min, max} | null }` — distinct present types (in `PAGE_TYPES` order), distinct tags sorted, min/max over derivable years; feeds the FilterBar.

- [ ] **Step 1: Failing tests** — identity on `EMPTY_FILTERS` (same reference); type filter; ANY-tag semantics; year range keeps undated pages and drops out-of-range papers; links pruned when one endpoint drops; combined filters; `filterOptions` shape.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** (also refactor `VizPage.paperYear` / `deriveTimeline`'s year fallback to call the new `pageYear` — one convention, one function).
- [ ] **Step 4: Run tests + full suite.**
- [ ] **Step 5: Commit** — `feat(viz): filterBundle + shared pageYear convention`

### Task 7: VizWorkspace shell + FilterBar (lens switcher, shared state)

**Files:**
- Create: `src/components/viz/VizWorkspace.tsx`, `src/components/viz/FilterBar.tsx`
- Modify: `src/app/viz/page.tsx` (thin shell)
- Test: `src/components/viz/__tests__/VizWorkspace.test.tsx`

**Interfaces:**
- Consumes: Task 6; existing `VizTabs` (reuse as the lens switcher), the four derive functions and view components, `loadCitationRefs`.
- Produces: `VizWorkspace({ bundle, refsByPageId, citationFetchState, onFetchCitations, onRecompute, busy })` owning `{lens, filters, selectedId}` state. Layout: `flex h-[calc(100vh-<shell-offset>)] flex-col` — toolbar row (lens switcher left; FilterBar + Recompute right), canvas area `flex-1 min-h-0`, inspector slot. Derivations: `filtered = useMemo(() => filterBundle(bundle, filters))`, then the four existing `derive*` calls move here from `page.tsx`, consuming `filtered`. Filters/selection survive lens switches (single component state — nothing resets on `lens` change). If the filtered graph has 0 nodes while the unfiltered has >0: inline "No pages match these filters" + "Clear filters" button (resets to `EMPTY_FILTERS`). `FilterBar({ options, filters, onChange })`: type multi-select chips, tag multi-select (searchable dropdown listing `options.tags`), year range dual-slider over `options.yearBounds` (hidden when null).
- `/viz/page.tsx` keeps only: vault/bundle/refs loading, Recompute + fetch-citations handlers, and renders `<VizWorkspace …/>`. `selectedId` clearing: selecting a lens where the selected node doesn't exist keeps the id (harmless — views ignore unknown ids).

- [ ] **Step 1: Failing tests** — `renderToStaticMarkup` with a small bundle: toolbar renders all four lens labels; filtered-to-empty state shows the clear-filters affordance; FilterBar renders type chips from `filterOptions`.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** (state + layout; wire existing views unchanged for now — selection wiring is Tasks 8–10).
- [ ] **Step 4: Run tests + full suite; `npm run build`** (layout touches the page shell — catch SSR/dynamic-import regressions now).
- [ ] **Step 5: Commit** — `feat(viz): VizWorkspace shell with shared lens/filter state`

### Task 8: Inspector panel + graph selection wiring

**Files:**
- Create: `src/components/viz/Inspector.tsx`
- Modify: `src/components/viz/VizWorkspace.tsx`, `src/components/viz/GraphView.tsx`
- Test: `src/components/viz/__tests__/Inspector.test.tsx`

**Interfaces:**
- Consumes: `Bundle`, `KnowledgeGraph`, Task 7 state.
- Produces: `Inspector({ bundle, id, neighbors, onSelect, onClose })` — right panel (`w-80 shrink-0 overflow-y-auto`, slides over the canvas on narrow viewports): `displayTitle`, type badge, tag chips, tldr (papers) or first ~280 body chars (else), backlink count via Task 4's `backlinkCount`, clickable neighbor list (`onSelect(neighborId)`), footer: "Open wiki page" (`wikiHref`) + "Open paper page" for papers (`/paper/<slug>`). Esc and click-away call `onClose` (which clears `selectedId`). `GraphView` gains props `{ selectedId?: string | null; onSelectNode?: (id: string | null) => void }` — Sigma `clickNode` → `onSelectNode(node)`, `clickStage` → `onSelectNode(null)`. Neighbor list computed in VizWorkspace from `graph.edges` of the *filtered* graph.

- [ ] **Step 1: Failing tests** — Inspector renders title/type/tags/backlink count; paper footer includes `/paper/<slug>`; neighbor buttons present.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement + wire into VizWorkspace** (inspector renders only when `selectedId` resolves to a page in the filtered bundle).
- [ ] **Step 4: Run tests + full suite.**
- [ ] **Step 5: Commit** — `feat(viz): node inspector + graph click-to-select`

### Task 9: Obsidian-grade GraphView upgrade

**Files:**
- Modify: `src/components/viz/GraphView.tsx`, `src/components/viz/labels.ts` (if label logic lives there)
- Test: extend `src/components/viz/__tests__/GraphView.test.tsx` (pure helpers only — reducers/size mapping; no WebGL in jsdom)

**Interfaces:**
- Consumes: Task 8's props; SP1 theme tokens (read via CSS variables at mount, both themes).
- Produces (all GraphView-internal — no API change beyond Task 8's props):
  - Hover: node + neighbors full color, all else faded (Sigma `nodeReducer`/`edgeReducer` with a `hoveredId` ref; fade = token-derived muted color, not opacity hacks that fight WebGL).
  - Selection (from `selectedId` prop): persistent neighborhood focus, same reducer path as hover; selected node ring/size boost.
  - Labels: zoom-threshold reveal — `labelRenderedSizeThreshold` tuned so only large nodes label when zoomed out; export a pure `labelThresholdForRatio(ratio: number): number` helper and test it.
  - Node size: continuous degree scaling `size = min + (max-min) * sqrt(degree/maxDegree)` — export pure `nodeSize(degree, maxDegree)` and test boundary cases (degree 0, maxDegree 0).
  - Community colors: map Louvain community index onto a token-driven categorical palette read from CSS vars (define `--viz-cat-1…8` in `globals.css` for BOTH light and dark blocks; fallback array for tests). No raw hex in the component.
  - Force layout: tune settings (gravity, scalingRatio, slowDown) as named constants with a comment on each.

- [ ] **Step 1: Failing tests for the pure helpers** (`nodeSize`, `labelThresholdForRatio`, community→CSS-var mapping).
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** (reducers, tokens in `globals.css`, tuned layout).
- [ ] **Step 4: Run tests + full suite + `npm run build`.**
- [ ] **Step 5: Commit** — `feat(viz): Obsidian-grade graph — hover/selection focus, zoom labels, token palette`

### Task 10: Wire the other three lenses (selection + filters + polish)

**Files:**
- Modify: `src/components/viz/TimelineView.tsx`, `CitationFlowView.tsx`, `AuthorNetworkView.tsx`, `VizWorkspace.tsx`
- Test: extend each view's existing test file

**Interfaces:**
- Consumes: filtered derivations (already flowing from Task 7), `selectedId`/`onSelect` from workspace state.
- Produces: each view accepts optional `{ selectedId?: string | null; onSelect?: (id: string | null) => void }`. Timeline: clicking an item selects it; selected item gets the highlight token style. CitationFlow: clicking a paper node selects (papers only — external citation refs aren't pages; they stay non-selectable). AuthorNetwork: author nodes select their `wiki/authors/...` page id. Selected-but-absent ids are silently ignored by each view. Light polish only: consistent token colors, hover states, fit-to-container in the new full-height canvas (no rewrites).

- [ ] **Step 1: Failing tests** — each view: renders a selected-state marker for `selectedId`, click handler fires `onSelect` with the page id, unknown `selectedId` renders identically to none.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement all three + remove the now-dead per-view code paths in `page.tsx` if any remain.**
- [ ] **Step 4: Run tests + full suite.**
- [ ] **Step 5: Commit** — `feat(viz): selection + filter wiring across timeline, citations, authors lenses`

### Task 11: Final gate — routing tests, suite, lint, build, browser walk, docs

**Files:**
- Modify: `CLAUDE.md`, spec status block, `docs/superpowers/plans/2026-07-23-sp3-wiki-dashboard-viz-workspace.md` (status)
- Test: whole repo

- [ ] **Step 1: Full verification** — `npx vitest run` (all green), `npx tsc --noEmit`, `npm run lint` (≤ 8 errors/5 warnings baseline), `npm run build`.
- [ ] **Step 2: Browser manual checklist** (self-driven via preview tools against the real dev server, both themes):
  - `/wiki` dashboard on the real vault: stats correct, shelves show TL;DRs, shelf card → `/paper/[key]`, View-all expansion, Browse-all tree intact, empty-vault state (point `SCISPARK_VAULT` at a scratch dir).
  - Delete a scratch page → confirm card shows backlink count → page gone from dashboard + index → undo from inbox restores it.
  - `/viz`: set filters in Graph → switch all four lenses → same subset; select node → inspector → neighbor click; open-wiki/open-paper links; filtered-to-empty + clear; hover/selection focus + zoom labels in graph.
- [ ] **Step 3: Update docs** — CLAUDE.md status paragraph (SP3 built), spec Status line, plan status; note any deviations discovered during the walk.
- [ ] **Step 4: Commit** — `docs: SP3 status — wiki dashboard + viz workspace built`; then whole-branch review per superpowers:requesting-code-review.

---

## Self-Review Notes

- Spec coverage: §1 dashboard → Tasks 1–3; §2 page actions → Tasks 4–5; §3 workspace → Tasks 6–10; §4 edge cases → distributed (empty vault T3, empty filters T7, delete errors T5); §5 testing → per-task + T11; §6 files → matches.
- Deliberate scope calls: shelf "View all" renders inline (no new route); Tree paper-routing implemented inside `Tree.tsx` only; year filter never drops undated pages; delete allowed for ingested papers (undo exists), forbidden only for reserved/user-model pages.
- Type-consistency check done on `ShelfEntry`/`VizFilters`/`Inspector` props across tasks.
