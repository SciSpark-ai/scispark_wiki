# SP3 — Knowledge Home: Wiki Dashboard + Viz Workspace (UI/UX redesign, part 3 of 6)

**Date:** 2026-07-23
**Status:** Built — 2026-07-24, branch `uiux/sp3-wiki-dashboard-viz-workspace`, 11 tasks via subagent-driven development, 1708 tests green, whole-branch review READY TO MERGE, live hand-driven against a real vault. **Deferred from spec §2:** the delete confirm's "lands in the review inbox with one-click undo" premise did not hold — the review inbox renders only lint/generation items, and a delete writes a changeset (recoverable on disk via the revert route, listed by `listIngests`) but no review item, so there is no one-click UI undo. Deletes ship confirm-gated + recoverable, with honest copy ("no one-click undo yet"); a general changeset-undo/History surface is SP6.
**Origin:** The six-SP redesign brainstormed 2026-07-16 (see `2026-07-16-sp1-shell-and-system-design.md`). SP1 (shell) and SP2 (core paper loop, plus the SP2.1 follow-ups) have shipped. This spec is SP3: `/wiki` becomes the researcher's knowledge-base dashboard and `/viz` becomes a Litmaps-inspired visualization workspace.

## Context

Today `/wiki` is a bare file tree with a New-note button, and `/viz` is a plain tab switcher over four independent views. The SP1 brainstorm settled the direction (recorded in that spec's cross-SP decisions): the wiki front page becomes a **dashboard** ("library IS the wiki" — saved vs fully-processed shelves), wiki Papers entries route to the SP2 paper page, every wiki item is editable + deletable from its page, and the four viz views stay but become a **workspace where the user chooses the lens**, with the graph reaching Obsidian-grade visual quality.

Decisions made in this brainstorm (Tong, 2026-07-23):

- Dashboard's organizing principle: **stats + mixed overview** (stats header over shelves + type sections + recent activity), not shelves-only or topic-clusters-only.
- Viz depth: **full workspace** — shared lens switcher, cross-lens filters that persist, click-any-node inspector panel.
- Per-page scope: **consistent actions only** (action row: Edit / Delete / open-paper-page link) — no reading-experience redesign.
- The current Tree survives as a secondary **"Browse all"** toggle on `/wiki`; nothing is lost.
- Shelf paper cards show the **TL;DR** (two-line clamp; `saved` papers without a `tldr` fall back to the first line of the abstract).
- Approach: **shared-state workspace refactor** (approach 1) — one `VizWorkspace` owns `{lens, filters, selectedId}`; the four derive functions keep their signatures and consume a pre-filtered bundle.

## Goal

After SP3: landing on `/wiki` answers "what's in my knowledge base and what changed" at a glance — counts, paper shelves by save-tier, knowledge sections, recent activity — with the full tree one toggle away; every wiki page has a consistent Edit/Delete action row with undoable deletes; and `/viz` feels like a workspace, not a demo: full-height canvas, four lenses over one filtered subset of the vault, an inspector that links every node back to its wiki/paper page, and a graph view that looks as good as Obsidian's.

Non-goals (their SPs or deliberate): `/paper/[key]` page changes (SP2, done); per-page history / History tab (SP6); wiki page reading-experience redesign (later SP); trending visuals (SP4); any new LLM calls (SP3 is zero-LLM throughout, like M8); persisted view state / layouts (nothing stored — both surfaces stay pure derivations over the bundle); cascade-blocking deletes (broken links are lint's job).

## 1. `/wiki` — the knowledge-base dashboard

`src/app/wiki/page.tsx` is rebuilt around a **Dashboard / Browse all** toggle in the page header ("New note" button and inbox badge stay in the header). "Browse all" renders the existing `Tree` unchanged. The dashboard view, top to bottom:

1. **Stats strip** — 4–5 small cards, all pure derivations: papers (with per-status split saved/enriched/ingested), knowledge pages (concepts+methods+findings+comparisons+topics), ideas, notes, and review-inbox count (links to `/wiki/inbox`).
2. **Paper shelves** — three horizontal, scrollable shelves: **Saved** (`status: saved`), **Enriched** (`status: enriched`), **In knowledge base** (`status: ingested`). Each shows compact paper cards — `displayTitle`, tag chips, status badge, and a two-line TL;DR (fallback: first line of abstract for `saved`). Cards click through to **`/paper/[key]`** — this closes the SP2-deferred routing item; the same routing applies to Papers entries in the Browse-all tree and type sections. Each shelf ends in a "View all" affordance expanding to the full list for that status.
3. **Type sections** — concepts / methods / findings / comparisons / topics / ideas / notes / authors: each section shows the most recently updated pages plus an "All →" link; empty sections don't render. Idea cards keep their `status`/`depth` badges (M9).
4. **Recent activity strip** — pages ordered by `updated` desc, phrased in user language ("Updated [[attention-decoding]]"), never changeset ids or skill codenames (SP1's no-dev-language rule).

**Data flow:** one new pure function `deriveWikiDashboard(bundle)` in `src/lib/wiki/dashboard.ts` returns `{stats, shelves, sections, recent}`; the page composes it via `useMemo` over the existing `loadBundle(vault)` load. No new endpoints, no storage, zero LLM.

## 2. Consistent page actions on `/wiki/[...id]`

The wiki page view keeps its current layout and editor; SP3 adds a consistent **action row**: Edit (existing), **Delete**, and — on paper pages — "Open paper page →" (`/paper/[key]`).

**Delete:** confirm dialog shows the backlink count ("3 pages link here") computed from the bundle; the delete itself is an atomic **changeset** (same machinery as ingest), so it lands in the review inbox with one-click undo; after deleting, navigate back to `/wiki`. Deleting a linked-to page is allowed — resulting broken wikilinks are deterministic-lint findings, not a blocker. Protected paths (`index.md`, `log.md`, `purpose.md`, `schema.md`, user-model pages) don't get a Delete button.

## 3. `/viz` — the visualization workspace

`src/app/viz/page.tsx` becomes a thin shell; a new **`VizWorkspace`** client component owns the layout and shared state.

**Layout:** full-height workspace — a slim toolbar on top, canvas filling the remaining viewport, inspector panel sliding in from the right.

- **Toolbar left — lens switcher:** segmented control: Graph / Timeline / Citations / Authors.
- **Toolbar right — filters + Recompute:** page-type multi-select, tag multi-select, year-range slider; the existing Recompute and (on the Citations lens) Fetch-citations actions.

**Shared state:** `{lens, filters: {types, tags, yearRange}, selectedId}` lives in `VizWorkspace`. **Filters and selection persist across lens switches** — filter to "2023–2025 + attention" in the graph, switch to Timeline, and you see the same subset's other projection; a node selected in the graph stays selected/highlighted in lenses where it appears.

**Filtering at the derivation layer:** one new pure function `filterBundle(bundle, filters)` (in `src/lib/viz/filter.ts`) returns the filtered page subset; the four existing `derive*` functions **keep their signatures** and consume the filtered input. Filtering is implemented once, tested once. An empty filter object is the identity.

**Inspector:** clicking any node opens the right panel: title, type badge, tags, TL;DR/abstract excerpt, backlink count, and a clickable neighbor list (click → select that node). Footer actions: "Open wiki page" and, for paper nodes, "Open paper page". Click-away or Esc closes; closing clears `selectedId`.

**Obsidian-grade graph (GraphView-internal only):** hover → highlight neighbors, fade the rest; selection → neighborhood focus; zoom-leveled label reveal (small-node labels appear only when zoomed in); continuous degree-based node sizing; Louvain community colors mapped to theme tokens (light + dark palettes); tuned force-layout parameters. The other three lenses get workspace-layout adaptation + selection/filter wiring + light visual polish, not rewrites.

## 4. Edge cases & errors

- **Empty vault:** dashboard shows an onboarding empty state ("Search for papers →"); workspace keeps the existing "Nothing to visualize yet" state.
- **Filters match nothing:** inline "No pages match these filters — clear filters" notice in the canvas area; never an error.
- **Delete failures:** surfaced on the confirm dialog (same error-surface discipline as CaptureIdeaCard), never swallowed.
- **No caches introduced:** both surfaces remain derive-on-load; the vault changing in another tab is handled by the existing Recompute affordance.

## 5. Testing

- **Pure-function units:** `deriveWikiDashboard` (per-status counts, shelf ordering, recent ordering, empty-section elision), `filterBundle` (type/tag/year combinations, identity on empty filters).
- **Component tests** (`react-dom/server` render, existing `.test.tsx` channel): stats numbers, shelf card TL;DR + clamp + abstract fallback, inspector content, delete-confirm backlink line, protected-path Delete suppression.
- **Routing tests:** shelf cards and wiki Papers entries → `/paper/[key]`; Browse-all tree links stay canonical via `wikiHref`.
- **Browser manual checklist (post-build, self-driven in the preview):** dashboard on a full and an empty vault; lens switch preserving filters; inspector click-through; delete → inbox undo round-trip; both themes.

## 6. Files (expected shape)

- **New:** `src/lib/wiki/dashboard.ts`, `src/lib/viz/filter.ts`, `src/components/wiki/dashboard/` (`StatsStrip.tsx`, `Shelf.tsx`, `TypeSections.tsx`, `RecentStrip.tsx`), `src/components/viz/VizWorkspace.tsx`, `src/components/viz/Inspector.tsx`, `src/components/viz/FilterBar.tsx`.
- **Reworked:** `src/app/wiki/page.tsx` (dashboard + Browse-all toggle), `src/app/viz/page.tsx` (thin shell), `src/components/viz/GraphView.tsx` (visual upgrade), the three other views (wiring), `src/app/wiki/[...id]` page (action row + delete).
