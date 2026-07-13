# M8: Visualization Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The visualization dashboard — four pluggable views over the wiki's derived data: knowledge graph (Sigma.js + graphology, Louvain communities, llm_wiki's four-signal relevance weights), field timeline, citation/influence flow, and author collaboration network (custom D3). Derived, never stored: every view recomputes from the bundle.

**Architecture:** A pure **derivation layer** (`src/lib/viz/`) turns a `Bundle` into typed view datasets — graph nodes/edges (weights = wikilinks ×3.0 + shared sources ×4.0 + Adamic-Adar ×1.5 + type affinity ×1.0; communities via graphology-Louvain), timeline lanes, co-authorship pairs, and citation edges. All of it is deterministic and unit-tested in Node. Citation edges need reference lists we don't store, so M8 adds one **`/api/citations` proxy route** (Semantic Scholar references passthrough, reusing M3's TtlCache/TokenBucket/privacy discipline) and an app-owned local cache (`.scispark/citations/`, like the digest cache). The **`/viz` page** renders four tabs: the graph view is Sigma.js (WebGL, client-only via `next/dynamic ssr:false`, same discipline as pdf.js); the other three are React-rendered SVG using small d3 modules for scales/forces/shapes. Click-through: every node/item deep-links to its wiki page.

**Tech Stack:** Existing M1–M7 stack + new deps: `sigma`, `graphology`, `graphology-communities-louvain` (graph view) and `d3-scale`, `d3-force`, `d3-shape` (+ `@types/*`) for the D3 views. Adamic-Adar is a ~15-line pure function — no extra dep.

## Global Constraints

- **Zero LLM calls in M8.** Every view is a deterministic projection over the bundle (+ cached citation metadata). No `runSkill`, no tiers, no budget. The milestone's "live gate" is therefore a **browser verification pass** over a seeded vault instead of an LLM gate.
- **Derived views are never stored** (design 02): no derived dataset is written to the vault. The only new persisted artifact is the app-owned citation-reference cache under `.scispark/citations/` (raw upstream metadata, same rationale as `.scispark/digests/`), which feeds derivation but is not itself a derived view.
- **Graph relevance weights are llm_wiki's, verbatim** (design 02): wikilinks ×3.0, shared sources ×4.0, Adamic-Adar ×1.5, type affinity ×1.0. Encode them as named constants in one place.
- **All remote fetches go through the server proxy** with M3's discipline: the new `/api/citations` route holds the S2 key server-side (reuse `S2_API_KEY` env), applies TtlCache + TokenBucket + single-flight, and **never logs paper ids/queries**. No client-direct calls to any upstream host.
- **Derivation is pure and Node-testable**: `Bundle` (+ plain data) in, typed datasets out — no DOM, no network, no storage inside derivation functions. Orchestration (loading the bundle, reading the citation cache) stays in the page/loader layer.
- **Client-only rendering discipline**: Sigma.js touches WebGL/canvas — the graph view MUST be loaded via `next/dynamic(..., { ssr: false })` and must not import sigma at module top of any SSR-reachable file (same pattern as `PdfSurface`). D3 views render SVG in `"use client"` components; d3 modules used only for math/layout (scales, force ticks, path generators), with React owning the DOM.
- **Every node/item is a deep-link** into the app (wiki page `/wiki/<id>`, reader, or author page) — the dashboard is a navigation surface, not a static picture.
- Design tokens: espresso/orange/border-warm palette, Halant headings; community colors may extend the palette but must keep text/contrast consistent with the app.
- Tests: vitest, colocated `__tests__/`. `npx tsc --noEmit` clean at every commit; `npm run build` succeeds for every task that changes app code. Existing tests keep passing.
- Pin new dependency versions explicitly (no caret) — verify current versions and API shape (sigma v3+ and graphology have post-training-data changes; use context7 or the packages' own `.d.ts` before writing against them).

---

### Task 1: Deps + knowledge-graph derivation core

**Files:**
- Modify: `package.json` (add `sigma`, `graphology`, `graphology-communities-louvain`, `d3-scale`, `d3-force`, `d3-shape` + types, exact-pinned)
- Create: `src/lib/viz/graph.ts`
- Test: `src/lib/viz/__tests__/graph.test.ts`

**Interfaces:**
- Consumes: `Bundle`/`WikiPage` (M1 `src/lib/vault/bundle.ts` — `pages: Map<id, WikiPage>`, `links: Array<{from,to}>`), frontmatter `related[]`/`sources[]`/`type`.
- Produces:

```ts
export const SIGNAL_WEIGHTS = { wikilink: 3.0, sharedSource: 4.0, adamicAdar: 1.5, typeAffinity: 1.0 } as const

export interface GraphNode {
  id: string            // bundle page id, e.g. "wiki/concepts/foo"
  title: string
  type: string          // frontmatter type
  community: number     // Louvain community index
  degree: number        // weighted degree (for sizing)
}
export interface GraphEdge {
  source: string
  target: string
  weight: number        // combined signal score
  signals: { wikilink: number; sharedSource: number; adamicAdar: number; typeAffinity: number }
}
export interface KnowledgeGraph { nodes: GraphNode[]; edges: GraphEdge[]; communities: number }

export function deriveKnowledgeGraph(bundle: Bundle): KnowledgeGraph
export function adamicAdar(neighbors: Map<string, Set<string>>, a: string, b: string): number
```

**Details:**
- **Edge signals** (undirected; one edge per unordered pair, signals summed into `weight` via `SIGNAL_WEIGHTS`):
  - *wikilink*: 1 if either page wikilinks the other (from `bundle.links`, both directions collapse to one signal; `related[]` frontmatter counts as a wikilink signal too — resolve bare slugs the same way the bundle does).
  - *sharedSource*: number of `sources[]` entries the two pages share (exact string match), capped at 3 (avoid one shared paper dwarfing everything — cap noted as our deviation, llm_wiki uncapped).
  - *adamicAdar*: over the wikilink+related neighbor sets — `Σ 1/log(|N(z)|)` for common neighbors `z` with `|N(z)| ≥ 2` (skip degree-1 to avoid log(1)=0 division; document).
  - *typeAffinity*: 1 when the pair's types are an affine pair — `paper↔concept`, `paper↔method`, `paper↔finding`, `concept↔topic`, `finding↔comparison`, same-type `concept↔concept` — else 0. (Starting heuristic; constant table, easy to tune.)
  - Pairs with all-zero signals get **no edge** (never materialize the O(n²) zero matrix — iterate only pairs connected by at least one signal source).
- Exclude `index.md`/`log.md`-style reserved pages (bundle only loads `wiki/`, so this is mostly type hygiene); include all 10 page types.
- **Louvain**: build a graphology `Graph` (undirected, weighted) and run `graphology-communities-louvain` with a **fixed `rng` seed** so derivation is deterministic for tests; single-node/empty graphs → community 0, no crash.
- `degree` = sum of incident edge weights.

**Steps:**
- [ ] **Step 1:** `npm install` the six deps exact-pinned (verify current versions via `npm view <pkg> version`; check sigma v3 / graphology API via context7 or node_modules `.d.ts` — do NOT trust training-data API memory). `npm run build` still green with deps added.
- [ ] **Step 2:** Failing tests: two pages wikilinking → one edge with wikilink signal ×3.0; `related[]` slug resolves to the same signal; two papers sharing 2 sources → sharedSource=2 → +8.0; shared-source cap at 3; Adamic-Adar on a known small graph (hand-computed value, tolerance 1e-9); type-affinity pairs table; all-zero pair → no edge; deterministic Louvain (same input → same communities across two runs); empty bundle → empty graph; degree = incident weight sum.
- [ ] **Step 3:** Run → FAIL. Implement.
- [ ] **Step 4:** `npx vitest run src/lib/viz` PASS; full suite green; tsc clean.
- [ ] **Step 5:** Commit: `feat(viz): knowledge-graph derivation (4-signal weights + Louvain) + viz deps`

---

### Task 2: Timeline + author-network derivation

**Files:**
- Create: `src/lib/viz/timeline.ts`, `src/lib/viz/authors.ts`
- Test: `src/lib/viz/__tests__/timeline.test.ts`, `src/lib/viz/__tests__/authors.test.ts`

**Interfaces:**

```ts
// timeline.ts — papers/findings by date, laned per topic
export interface TimelineItem {
  id: string; title: string; type: "paper" | "finding"
  date: string          // paper: `${year}-01-01` from frontmatter.year (fallback created); finding: frontmatter.created
  year: number
  laneIds: string[]     // topic-page ids this item belongs to (possibly several)
}
export interface TimelineLane { id: string; title: string; itemCount: number }
export interface Timeline { lanes: TimelineLane[]; items: TimelineItem[]; minYear: number; maxYear: number }
export function deriveTimeline(bundle: Bundle): Timeline

// authors.ts — co-authorship network from paper frontmatter
export interface AuthorNode {
  key: string           // normalized author name (lowercased, collapsed whitespace)
  name: string          // display name (first-seen casing)
  paperCount: number
  pageId: string | null // wiki author page id when one exists (match by normalized name)
}
export interface CoauthorEdge { a: string; b: string; papers: number } // keys; papers = co-authored count
export interface AuthorNetwork { nodes: AuthorNode[]; edges: CoauthorEdge[] }
export function deriveAuthorNetwork(bundle: Bundle): AuthorNetwork
```

**Details:**
- **Timeline lanes** = `topic` pages. An item belongs to a lane when the item wikilinks/`related[]`-references the topic page or vice-versa (either direction — reuse the neighbor sets from Task 1's helpers; export a shared `neighborSets(bundle)` from `graph.ts` if useful). Items linked to no topic land in a synthetic "Unfiled" lane (`id: "__unfiled__"`). Items = `paper` pages (date from `frontmatter.year`, fallback `created`) + `finding` pages (date = `created`).
- Lanes sorted by `itemCount` desc; items sorted by date. `minYear`/`maxYear` from items (empty → current-year/current-year handled by caller; return 0/0 and document).
- **Author network**: for each `paper` page, read `frontmatter.authors` (string array — verify actual shape in `buildPaperPage`; it writes `authors: paper.authors.map(a => a.name)`). Normalize names (trim, collapse whitespace, lowercase for the key). Every unordered pair of co-authors on one paper → increment their edge's `papers`. `paperCount` per author. Link `pageId` when a `type: author` page's title normalizes to the same key.
- Both functions pure, no network/storage.

**Steps:**
- [ ] **Step 1:** Failing tests: paper with year 2024 + finding with created 2026-01-05 → correct dates/years; topic lane membership via wikilink in either direction; multi-topic item in both lanes; unlinked item → Unfiled; lane sort; author pairs (3-author paper → 3 edges), repeat co-authorship increments `papers`, name normalization ("A. B." vs "a. b."), author-page matching by title, no self-edges; empty bundle → empty results.
- [ ] **Step 2:** Run → FAIL. Implement.
- [ ] **Step 3:** `npx vitest run src/lib/viz` PASS; full suite green; tsc clean.
- [ ] **Step 4:** Commit: `feat(viz): timeline + author-network derivation`

---

### Task 3: Citations — proxy route, local cache, edge derivation

**Files:**
- Create: `src/app/api/citations/route.ts`, `src/lib/papers/citations-core.ts`, `src/lib/viz/citations.ts`
- Modify: `.env.example` (note S2_API_KEY reuse)
- Test: `src/lib/papers/__tests__/citations-core.test.ts`, `src/lib/viz/__tests__/citations.test.ts`

**Interfaces:**

```ts
// citations-core.ts (server) — S2 references passthrough, M3 discipline
export interface CitationRef { ids: PaperIds; title: string }
export async function fetchReferences(externalId: string, opts?: { fetchFn?: typeof fetch; apiKey?: string }): Promise<CitationRef[]>
export async function handleCitations(req: { id: string | null }): Promise<{ status: number; body: unknown }> // validates, cache, rate-limit, single-flight

// viz/citations.ts (client-side derivation + cache orchestration)
export const CITATIONS_DIR = ".scispark/citations"
export interface CitationEdge { citing: string; cited: string } // bundle page ids
export interface CitationFlow { edges: CitationEdge[]; papersWithData: number; papersTotal: number }

/** Reads cached reference lists and joins them against vault papers. Pure given its inputs. */
export function deriveCitationFlow(bundle: Bundle, refsByPageId: Map<string, CitationRef[]>): CitationFlow
/** Loads cached refs for every vault paper; optionally fetches missing ones via /api/citations. */
export async function loadCitationRefs(storage: VaultStorage, bundle: Bundle, opts?: { fetchMissing?: boolean; fetchImpl?: typeof fetch }): Promise<Map<string, CitationRef[]>>
```

**Details:**
- **Route** `GET /api/citations?id=<externalId>` where externalId is `DOI:<doi>` or `ARXIV:<id>` (validate the prefix + non-empty tail; 400 otherwise). Upstream: S2 Graph API `paper/{id}/references?fields=externalIds,title&limit=500`, key header when `S2_API_KEY` set (copy header/timeout/error mapping from the existing M3 `src/lib/papers/s2.ts` adapter). Normalize each reference's `externalIds` into our `PaperIds` (DOI/ArXiv/PubMed/CorpusId→s2). Wrap with M3's `TtlCache` (24h), per-route `TokenBucket`, single-flight, JSON-stringified cache key — read `src/lib/papers/search-core.ts`/`src/app/api/search/[source]/route.ts` and mirror. **Never log the id.** Upstream 404 → `{status: 200, body: {references: []}}` (a paper S2 doesn't know is empty, not an error).
- **Local cache**: `loadCitationRefs` reads `.scispark/citations/<paperSlug>.json` (shape `{fetchedAt, references: CitationRef[]}`) for each `type: paper` page that has a `doi` or `arxiv` id. With `fetchMissing: true` it GETs `/api/citations` for papers without a cache file and writes the cache (direct writes, app-owned; failures skip silently — partial data is fine). Papers with neither id are skipped (counted in `papersTotal` only).
- **Edge derivation** (`deriveCitationFlow`): build a lookup of vault papers by their id-based `paperKey` variants (doi + arxiv, reusing `paperKey` normalization via the same approach as M5's `vaultPaperKeys` — reuse/extend that helper rather than re-implementing). For each vault paper's reference list, any reference whose ids match another vault paper → edge `{citing, cited}`. Dedupe. Self-edges dropped.

**Steps:**
- [ ] **Step 1:** Failing tests — core: valid DOI/ARXIV ids accepted, junk 400; references normalized to PaperIds; 404→empty; cache hit skips upstream (fake fetch call count); rate-limit path returns 429 (mirror M3 test style). Derivation: A-cites-B where both in vault → one edge; reference matching via doi AND via arxiv; reference to a non-vault paper → no edge; dedupe + no self-edges; `loadCitationRefs` reads cache, `fetchMissing` writes it, fetch failure skips silently.
- [ ] **Step 2:** Run → FAIL. Implement.
- [ ] **Step 3:** `npx vitest run src/lib/viz src/lib/papers` PASS; full suite green; tsc clean; `npm run build` (new route) green.
- [ ] **Step 4:** Commit: `feat(viz): citations proxy route + local cache + citation-flow derivation`

---

### Task 4: /viz dashboard shell + knowledge-graph view (Sigma)

**Files:**
- Create: `src/app/viz/page.tsx`, `src/components/viz/VizTabs.tsx`, `src/components/viz/GraphView.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (add a "Dashboard"/graph nav entry to `/viz`)
- Test: build + browser-verified (UI); derivation already unit-tested

**Details:**
- **Page**: client page; `getOpenVault` → `loadBundle` → memoized `deriveKnowledgeGraph` (+ the other datasets as later tabs mount, lazily). Tab bar (`Graph | Timeline | Citations | Authors`) with the app's pill styling; each tab renders its view with the derived dataset. A small header line: "Derived from your wiki — recomputed live, nothing stored." Empty vault → friendly card ("Ingest a few papers to grow your graph") linking `/papers`.
- **GraphView** (`next/dynamic ssr:false` from the page): instantiate a graphology `Graph` from `KnowledgeGraph`, render with Sigma. Node color = community (a fixed warm-leaning categorical palette, ≥8 distinct hues), node size ∝ `degree` (clamped range), edge thickness ∝ `weight`. Interactions: hover highlights the node + its neighborhood (dim the rest via reducers); click → `router.push("/wiki/<id>")`; a type-filter row of checkboxes (papers/concepts/methods/…) that hides node types via reducers. Layout: seed positions with a simple deterministic circular/spiral placement then run graphology's ForceAtlas2 for a fixed iteration count if available in the pinned graphology ecosystem (`graphology-layout-forceatlas2`; add it exact-pinned if used — synchronous `assign` for ≤ few hundred nodes is fine), else d3-force ticks; either way positions computed client-side before render, no layout worker needed at vault scale.
- Dispose the Sigma instance on unmount (`sigma.kill()`) — no WebGL context leak on tab switches (mirror the pdf.js cleanup discipline).

**Steps:**
- [ ] **Step 1:** Implement page + tabs + GraphView + nav entry (add `graphology-layout-forceatlas2` exact-pinned if chosen).
- [ ] **Step 2:** Full `npx vitest run` green; `npx tsc --noEmit` clean; `npm run build` succeeds (`/viz` route listed).
- [ ] **Step 3:** Commit: `feat(viz): dashboard shell + Sigma knowledge-graph view`

---

### Task 5: Timeline + citation-flow views (D3/SVG)

**Files:**
- Create: `src/components/viz/TimelineView.tsx`, `src/components/viz/CitationFlowView.tsx`
- Modify: `src/app/viz/page.tsx` (mount the two tabs; Citations tab owns a "Fetch citation data" button → `loadCitationRefs(fetchMissing: true)` → re-derive)
- Test: build + browser-verified; any non-trivial pure layout helper (e.g. lane packing, column layout) goes in `src/lib/viz/layout.ts` with unit tests

**Details:**
- **TimelineView**: horizontal time axis (`d3-scale` `scaleLinear` over `minYear..maxYear`, ticks per year/decade as range demands), one horizontal lane per `TimelineLane` (top ~12 lanes by itemCount, rest collapsed into "Other"), items as dots/rounded rects at their date, colored by type (paper=orange, finding=espresso), `title` tooltip on hover, click → wiki page. React renders the SVG; d3 does math only. Wide ranges scroll horizontally inside the panel (`overflow-x: auto`).
- **CitationFlowView**: papers as nodes in **columns by year** (oldest left), stacked within a column; directed edges `citing → cited` drawn as cubic Bézier paths (`d3-shape` `linkHorizontal`), arrowhead marker, edge hover highlights the pair, click → wiki page. Isolated papers (no edges) listed in a side strip, not floated in the canvas. Header shows coverage: "citation data for N of M papers" + the fetch button state (idle/fetching/done; failures per paper skipped silently per Task 3).
- Empty datasets → per-tab friendly empty states (no crash, no blank canvas).

**Steps:**
- [ ] **Step 1:** Failing tests for any extracted layout helpers (column packing: papers→year columns preserving order; lane top-N + Other collapse).
- [ ] **Step 2:** Implement both views + page wiring + fetch button.
- [ ] **Step 3:** Full suite green; tsc clean; `npm run build` green.
- [ ] **Step 4:** Commit: `feat(viz): timeline + citation-flow views`

---

### Task 6: Author-network view + dashboard polish

**Files:**
- Create: `src/components/viz/AuthorNetworkView.tsx`
- Modify: `src/app/viz/page.tsx` (mount tab), small shared bits as needed
- Test: build + browser-verified; layout helpers unit-tested if extracted

**Details:**
- **AuthorNetworkView**: `d3-force` simulation (charge + link + collide + centering) run for a fixed tick count **synchronously on the client** (deterministic-ish; no animation loop needed), then render nodes/links as SVG. Node radius ∝ `paperCount` (clamped), label the top ~20 authors by paperCount (avoid label soup), edge width ∝ co-authored `papers`. Click → author wiki page when `pageId` non-null (else no-op with a "no author page yet" tooltip). Cap rendering at the ~200 highest-degree authors with a "showing top 200" note when exceeded.
- Polish pass across the dashboard: consistent panel chrome (border-warm rounded-card), the four tabs keep their derived data memoized per bundle load, a single "Recompute" button re-loads the bundle and re-derives everything (the vault may have changed in another tab).
- Log a Tier-1 event? **No** — M8 adds no new event types (dashboard views are not personalization signals in v1; keep scope tight).

**Steps:**
- [ ] **Step 1:** Implement view + polish + any tested helpers.
- [ ] **Step 2:** Full suite green; tsc clean; `npm run build` green.
- [ ] **Step 3:** Commit: `feat(viz): author collaboration network + dashboard polish`

---

### Task 7: Seeded-vault integration test + browser verification

**Files:**
- Create: `src/lib/viz/__tests__/integration.test.ts`
- (Controller step: browser pass)

**Details:**
- **Integration test** (Node, no browser): build a realistic in-memory vault via the real authoring path — `buildPaperPage`/`composePage` for ~6 papers (overlapping authors, shared sources, wikilinked concepts/topics/findings, plus hand-written citation-cache files where paper A references paper B's doi/arxiv) → `loadBundle` → run ALL FOUR derivations → assert cross-view coherence: graph has edges with the expected combined weights; Louvain yields ≥1 community; timeline lanes match the topic links; author network contains the seeded co-authorship pair with `papers: 2`; citation flow yields exactly the seeded A→B edges. This is the regression net for the whole derivation layer over production-shaped data.
- **Controller browser pass (Step 4, not a subagent):** seed the dev vault (or reuse the existing one), open `/viz`, and verify all four tabs render, hover/click navigation works, the citations fetch button round-trips through `/api/citations`, and no console errors. Screenshot each tab for the record. This replaces the LLM live gate (M8 makes zero LLM calls).

**Steps:**
- [ ] **Step 1:** Write the integration test (failing first where practical) → green.
- [ ] **Step 2:** Full suite green; tsc clean; `npm run build` green.
- [ ] **Step 3:** Commit: `test(viz): seeded-vault integration test across all four derivations`
- [ ] **Step 4 (controller):** browser verification pass; record findings in the ledger.

---

## Self-Review Notes

- Spec coverage: roadmap M8 = graph (Sigma) T1+T4, timeline T2+T5, citation flow T3+T5, author network T2+T6, all as derived views (design 02) with llm_wiki's weights (T1) and D3 for the non-graph views (design 05). Verification T7.
- Type consistency: `KnowledgeGraph`/`Timeline`/`AuthorNetwork`/`CitationFlow` defined in their derivation modules (T1–T3) and consumed by name in the views (T4–T6); `CitationRef`/`PaperIds` shared between core and derivation (T3).
- The one design deviation is flagged inline: shared-source signal capped at 3 (llm_wiki uncapped) — revisit if graphs look under-connected.
- Citation data is fetch-on-demand with local caching because reference lists aren't stored at ingest; if M9+ wants richer citation use, ingest-time prefetch can reuse `citations-core` unchanged.
- Zero-LLM milestone: no persona, no runSkill, no budget interactions; the browser pass replaces the live gate.
- Deferred (not M8): graph view search/filter beyond type toggles; timeline zoom/brush; citation flow for non-vault references ("ghost nodes"); dashboard events as personalization signals; Tauri-scale layout workers. All ride to M11 polish or later.
