# SP2 — Core Paper Loop (UI/UX redesign, part 2 of 6)

**Date:** 2026-07-17
**Status:** Built (SP2) — 2026-07-17, branch `uiux/sp2-core-paper-loop`, 14 tasks via subagent-driven development, 1550 tests green, whole-branch review READY (live-enrich gate + hands-on Save→enrich→ingest walk pending Tong)
**Origin:** The six-SP redesign brainstormed 2026-07-16 (see `2026-07-16-sp1-shell-and-system-design.md`). SP1 (shell/nav/tokens/settings) shipped 2026-07-17. This spec is SP2, the highest-value chunk: the discover→read→digest→save journey Tong called "the flow that doesn't make sense," rebuilt around one coherent paper page.

## Context

Today the journey is broken in exactly the ways Tong hit on his live walk: the feed card is a wall of "why this/you/now" prose with an unexplained score number; clicking it lands on `/papers?paperKey=` (a hidden single-paper view of the search page); the digest is crammed into the bottom of a search-result sub-card; a paywalled "Read" dead-ends in a tiny abstract card; and "Save" goes nowhere visible. SP2 replaces all of that with **one progressive paper page** and a **three-tier save model** where saving is instant and free and the wiki's Papers section *is* the library.

Cross-SP decisions this builds on (settled during the SP1 brainstorm, recorded in that spec): unified paper flow, three-tier save / library-is-the-wiki, Apple-News feed card, ask-anywhere onto the paper page. Approach **A** (one progressive `/paper/[key]` page for all states) was chosen 2026-07-17.

## Goal

After SP2: from the feed or search, one click opens a real, full-page paper page; Save is instant and free and the paper appears in the wiki; a cheap background pass enriches it (TL;DR, tags, links into your existing knowledge) within seconds; "Add to knowledge base" remains the deliberate deep step; and you can select any passage on the paper page to ask the AI about it. No dead-ends, no crammed sub-cards, no two-pages-per-paper.

Non-goals (their SPs): the `/wiki` dashboard's shelves-by-status visual and routing `/wiki` Papers entries to the new page (SP3); feed freshness/recency ranking (separate backend task); persistent highlights on the paper page (a reader feature — the paper page gets select→ask/capture only).

## 1. The progressive paper page — `/paper/[key]`

A new route `src/app/paper/[key]/page.tsx` (replacing the fork-mock `/paper/[id]`), keyed by the **sanitized paper slug** (`arxiv-2409-08710`), consistent with `wiki/papers/<slug>` and free of colon/slash URL-encoding problems. The fork prototype's `/paper/[id]` (`scispark-app-frontend`) is the visual reference: full-page, three-column-aware shell, not a sub-card.

**Resolution.** A shared `resolvePaperBySlug(storage, slug): Promise<PaperRecord | null>` — extracted from the duplicated `resolvePaper` logic currently in `src/app/reader/page.tsx` and `src/app/papers/page.tsx` (feed cache → wiki paper-page frontmatter → reader handoff). All three routes (`/paper/[key]`, `/reader`, `/papers`) consume it.

**State machine** — the page renders one of three states, derived from whether a `wiki/papers/<slug>.md` page exists and its `status` frontmatter:

| State | Trigger | Shows |
|---|---|---|
| **discovery** | no wiki page (fresh feed/search result, resolved from cache/handoff) | header (title via `displayTitle`, authors, venue·year, DOI/arXiv/PubMed chips), abstract, full-page digest (if generated), actions: Save · Generate digest · Add to knowledge base · Read full text |
| **saved** | wiki page, `status: saved` or `enriched` | the above + "Saved" state, the tier-2 TL;DR + tags + "Related in your knowledge base" links (resolved `relatedPageIds`), full why-this/you/now (if this paper came from the feed), an **Enrich** button, Add-to-knowledge-base to upgrade |
| **ingested** | wiki page, `status: ingested` | the KB synthesis (the wiki page body rendered), backlinks, a quiet "Edit in wiki →" link to `/wiki/papers/<slug>` |

The digest, when present, renders **full-page** (its six sections — key points, lay summary, methods, limitations, field context — laid out as a proper article, per the fork prototype), never a nested card. A paywalled paper (`full_text: false`) is a normal paper page — metadata + abstract + digest + actions — minus a working "Read full text" (that button is hidden or disabled with a "no open-access full text" note), never a dead-end card.

**Ask-anywhere.** Selecting text anywhere in the paper page's content (abstract, digest, synthesis) raises the selection toolbar → **Ask** (reuse the reading-companion skill + `buildAskContext`) and **Capture idea** (reuse `captureIdeaAsNote`). No persistent highlights here (that stays a reader feature). This reuses the reader's `SelectionBubble` + `AskPanel` + capture machinery via a shared extraction (§4). The dark-mode selection-toolbar restyle deferred from SP1's final review (the `bg-espresso`/`text-white` pill inverting to near white-on-cream) is fixed as part of this shared surface.

## 2. Three-tier save model

A `status` frontmatter field is added to paper pages: `"saved" | "enriched" | "ingested"`.

**Tier 1 — Save (deterministic, free, instant).** Writes `buildPaperPage(paper, { status: "saved", ... })` to `wiki/papers/<slug>.md` as one atomic, undoable changeset (so `index.md`/`log.md` update and it appears in the `/wiki` Papers bucket). No LLM call. `buildPaperPage` gains a `status` field in its emitted frontmatter (defaults preserve current ingest callers — ingest passes `"ingested"`). Both the feed card's Save and the paper page's Save call this; a second Save on an already-saved paper is a no-op (or re-affirm, never a duplicate page).

**Tier 2 — Enrich (light AI, ~$0.001–0.01, abstract-only).** A new `fast`-tier skill `src/lib/skills/enrich.ts` (+ `enrich-client.ts`, `POST /api/skills/enrich`):
- **Input:** paper metadata + abstract + the current wiki index (page titles + types, so it can propose links into *existing* knowledge without reading full pages).
- **Output (structured):** `{ tldr: string, tags: string[], relatedPageIds: string[] }` — a one-line summary, 2–5 short topical tags, and ids of existing wiki pages this paper relates to (validated against the index; unknown ids dropped).
- **Effect:** merged into the paper page via an atomic changeset — `tldr` into a new `tldr` frontmatter field, `tags` into the existing `tags` frontmatter array (union with whatever is there; ingest may later augment/replace them, which is fine — tags are advisory), `relatedPageIds` into `related[]` (union) — and `status → enriched`. The body is not rewritten by enrich; TL;DR/tags render from frontmatter.
- **When:** automatically as a background call right after a tier-1 save completes (fire-and-forget; the save is already durable, so enrich failure degrades to a still-valid saved page), AND on demand via the paper page's **Enrich** button (for a paper reached un-saved — Enrich then saves first — or to refresh).
- Metered and budget-gated like every skill; persona-free.

**Tier 3 — Add to knowledge base (full ingest, existing skill).** The existing ingest pipeline, unchanged except that it now upgrades an existing saved/enriched page rather than only creating fresh: ingest already merges frontmatter, so verify `status → ingested` lands and the tier-2 tags/related are preserved or supplanted cleanly. `estimate...`/cost-confirm behavior unchanged.

## 3. Feed card redesign

`src/components/feed/RealFeedCard.tsx` becomes a scannable Apple-News card: **headline** (`displayTitle`), venue·year, **AI TL;DR**, and a row of **small instant tags**. The **whole card is clickable → `/paper/[key]`**. Quick actions stay minimal: **Save** (tier-1) and **Dismiss**; the heavier actions (digest, ingest, read) live on the paper page. The bare **score chip is removed** (audit-flagged as meaningless to users). The full why-this/you/now prose is **not** on the card — it rides on the feed item and renders on the paper page's saved state.

**Feed skill output extension.** The re-rank step (`src/lib/skills/feed.ts`, the `whyThis/whyYou/whyNow` structured schema ~line 239, and `FeedItem` ~line 286) gains `tldr: string` and `tags: string[]` per item. Backward-compatible: both optional on `FeedItem`; the card falls back to the abstract's first sentence for TL;DR and to source/year-derived tags when absent, so an old cached feed still renders.

## 4. Shared extraction & `/papers` slimming

- **`resolvePaperBySlug`** — extracted to `src/lib/papers/resolve.ts` (or similar), replacing the duplicated resolver in `/reader` and `/papers`.
- **Askable surface** — the select→ask/capture interaction (`SelectionBubble`, `AskPanel`, the ask/capture handlers, `buildAskContext`, `askRemote`, `captureIdeaAsNote`) is factored into a reusable unit the reader and the paper page both mount. The reader keeps its persistent-highlight layer on top; the paper page mounts only the ask/capture parts. This is a refactor of `ReaderView` to lift the shared piece out, not a rewrite — the reader's behavior is unchanged.
- **`/papers` slims to search-only** — `src/app/papers/page.tsx` drops the selected-paper detail/digest sub-card entirely (that logic moves to the paper page); results list items link to `/paper/[key]`. Search remains a real, first-class surface.

## 5. Route wiring

- Feed card and `/papers` result → `/paper/[key]` (was `/papers?paperKey=` and `/reader`).
- The paper page's "Read full text" → `/reader?paperKey=` (the reader stays the full-text reading surface, unchanged).
- **Deliberate SP2/SP3 boundary:** the `/wiki` Papers bucket entries keep pointing at `/wiki/papers/<slug>` (the raw editable wiki view) for now; routing them to `/paper/[key]` is done inside SP3's wiki-dashboard redesign so SP2 doesn't half-touch the wiki Tree. The paper page's "Edit in wiki →" cross-link keeps both reachable meanwhile.

## 6. Architecture & files (expected shape)

- `src/app/paper/[key]/page.tsx` — NEW progressive paper page (replaces fork-mock). Client component; resolves via `resolvePaperBySlug`; renders discovery/saved/ingested via a small state resolver.
- `src/components/paper/` — NEW: `PaperHeader`, `PaperActions` (state-aware action row), `PaperDigestView` (full-page digest, lifted from the current `DigestPanel`'s content but full-width), `RelatedInWiki`, and the shared askable surface.
- `src/lib/papers/resolve.ts` — NEW shared `resolvePaperBySlug`.
- `src/lib/skills/enrich.ts`, `enrich-client.ts`, `src/app/api/skills/enrich/route.ts` — NEW tier-2 skill (fast tier, structured output, wiki-index input).
- `src/lib/wiki/authoring.ts` — `buildPaperPage` gains `status`; a tier-1 save helper (`savePaperStub`) that composes the changeset.
- `src/lib/skills/feed.ts` — re-rank schema + `FeedItem` gain optional `tldr`/`tags`.
- `src/components/feed/RealFeedCard.tsx` — redesigned card.
- `src/app/papers/page.tsx` — slimmed to search-only.
- `src/components/reader/ReaderView.tsx` — refactored to share the askable surface (behavior unchanged).
- Removed: fork-mock `/paper/[id]` page; the `/papers` selected-paper detail block.

## 7. Testing

- Unit: `resolvePaperBySlug` (each resolution source + not-found); paper-page state resolver (discovery/saved/ingested from bundle+status); tier-1 `savePaperStub` writes a schema-valid page with `status: saved` + appears in index (changeset test); `enrich` skill output validation (tags/relatedPageIds filtered against index, tldr present) + a `LIVE_LLM_*` gate; tier-3 ingest upgrades an existing saved page to `status: ingested` preserving provenance; feed card renders new tldr/tags and falls back when absent; feed re-rank schema accepts+round-trips tldr/tags; the shared askable surface asks/captures on the paper page (jsdom).
- Browser (with Tong): feed card → paper page; Save (instant, appears in /wiki) → auto-enrich populates TL;DR/tags/related within seconds → Add-to-KB upgrades; paywalled paper is a real page not a dead-end; select→ask on the paper page in both themes; the dark-mode selection toolbar reads correctly.
- Gates: full suite green, `tsc`, lint baseline (8/5, zero new), build.

## 8. Open questions

None blocking. Deferred-by-design: the `/wiki`-entries → `/paper/[key]` routing and status shelves (SP3); the exact enrich prompt tuning (settled during build against the live vault).
