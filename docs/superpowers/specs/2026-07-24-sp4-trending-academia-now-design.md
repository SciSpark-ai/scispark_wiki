# SP4 — Academia Right Now: Trending Rework (UI/UX redesign, part 4 of 6)

**Date:** 2026-07-24
**Status:** Designed — approved by Tong 2026-07-24 (approach C, sections 1–6 approved in conversation)
**Origin:** The six-SP redesign brainstormed 2026-07-16 (see `2026-07-16-sp1-shell-and-system-design.md`, whose roadmap row reads "SP4 | Trending redesign: broader 'academia right now' fields + visual overhaul (incl. its backend/field-selection component)"). SP1–SP3 have shipped.

## Context

`/trending` today (M10 + v1.1) renders one panel per tracked field, where a field is a narrow free-text label lifted from `interests.md` ("auditory attention decoding (EEG)"). Each panel shows a momentum stat, a weekly-volume line, top movers by citation count, and an LLM survey (notable papers, emerging topics, momentum narrative).

Tong's verdict on the live page (2026-07-24): the fields are **too narrow and badly chosen**, and the page is **visually flat with low information density**. Asked whose trends the page should show, he chose **academia-wide as the主体, personal interests as a lens**.

Decisions made in this brainstorm (Tong, 2026-07-24):

- **Scope:** academia-wide primary; the user's interests act as a lens, not as the boundary.
- **Breadth:** the academia layer is bounded to the user's **adjacent broad disciplines**, auto-derived by rolling narrow interests up to their OpenAlex parent field (overridable in settings). Not literally all of academia (medicine/CS volume would drown everything), not a hand-picked discipline list.
- **Page skeleton:** a **heating-topics leaderboard** is the first-class object, mixed across disciplines (discipline is a chip, not a section header).
- **Lens mechanism:** highlight entries relevant to the user, and connect entries to the knowledge base. **No per-row KB counts** — Tong judged "3 papers in your library" numerically useless; the KB connection surfaces as links to actual pages, not as a count.
- **Cost:** content-first; the daily budget cap remains the only ceiling.
- **Computation (approach C):** all ranking and all numbers are deterministic (OpenAlex `group_by`); the LLM is restricted to qualitative interpretation. Rejected: pure-deterministic with no interpretation (A, thin), and LLM-clustered topics (B, no real numbers, unstable ranking, violates the project's no-LLM-emitted-numbers rule).

## Goal

After SP4, `/trending` answers "what is happening in my corner of academia right now" in one dense, scannable screen: a ranked leaderboard of topics that are genuinely accelerating, with real growth numbers, sparklines, the discipline each belongs to, a marker on the ones that touch the user's work, and — on expand — a written account of why each is heating up plus its representative papers. Field selection stops being a hand-written narrow label and becomes an auto-derived, adjustable discipline anchor.

Non-goals (their SPs or deliberate): public/anonymous trending and a server cron (documented v2 growth path, unchanged); changes to the home feed; KB chat (SP5); Projects/History (SP6); any LLM-emitted number.

## 1. Information architecture

**The core separation.** Two concepts that are currently conflated:

| Concept | Role | Source |
|---|---|---|
| **Anchor disciplines** (1–3) | the *scope* of the leaderboard | auto-derived by rolling interest labels up to their OpenAlex parent field; overridable in settings |
| **Interest labels** (existing narrow strings) | the *lens* — which rows get marked as relevant | `interests.md` / trending settings, unchanged |

The narrow labels are not discarded; they change job.

**Page, top to bottom:**

1. **Header** — title, anchor-discipline chips (click through to the settings editor), last-updated, Refresh.
2. **Overview strip** — three figures: total new papers this window across anchor disciplines · the fastest-rising topic (name + %) · how many rising topics are relevant to the user.
3. **Heating-topics leaderboard (the page's body)** — one list, **mixed across disciplines**, ranked by growth. Each row: rank · growth badge · topic name · a prior→recent comparison bar · discipline chip · a "relevant to you" marker when the lens matches. Rows expand in place to show the LLM's account of why the topic is heating up plus up to 3 representative papers (each with a one-line why, linking to `/paper/[key]`). Where a topic's representative paper already exists in the wiki, its row links to that page — the KB connection is a link, never a count.
4. **Breakout papers** — a secondary strip of recent papers with unusual citation velocity, deterministically ranked.

## 2. Anchor-discipline derivation

`deriveAnchorDisciplines(labels, searchFn)`: for each interest label, run one OpenAlex search and take the modal `topics[].field` across the returned works; dedupe across labels; cap at 3. Cached in trending settings so a refresh does not re-derive; recomputed only when the interest labels change or the user clears the override.

Overridable: the settings modal's trending section gains an anchor-discipline editor (replacing the raw field list). A user-set anchor wins over derivation and is never silently recomputed.

Requires a small extension to the OpenAlex adapter: the topic hierarchy (`subfield`/`field`/`domain`) currently collapses to display names in `mapFields`; the field level must survive into `PaperRecord` (or be read from a dedicated call) for the modal computation.

## 3. Leaderboard computation (deterministic)

**Corrected 2026-07-25 after the live run — see "The 200-bucket horizon" below. The original two-group-by design is superseded.**

Per anchor discipline, **one** `group_by=primary_topic` request over the **recent window** yields the candidate topics and their recent counts. Windows follow v1.1's week-aligned convention: the recent window is the **last 2 complete ISO weeks**, the prior window the **2 complete weeks before those**. Each candidate's **prior count is then looked up directly** — one `filter=primary_topic.id:<id>,from_publication_date:…,to_publication_date:…` count request per candidate (1 credit each), reading the true total rather than inferring it from a second grouped list. Then:

- **Growth** `(recent − prior) / prior`, `null` when prior is 0 (rendered as "new", never as ∞ or a fake %).
- **Volume floor:** topics with fewer than **5 papers in the recent window** (a named constant, tunable in one place) are excluded from ranking outright — without it, 2→5 papers reads as +150% and noise dominates the board.
- **The in-progress week is excluded entirely** from both windows. This also retires the M10 caveat where the newest bucket was a partial week, making every field look like it was declining.
- Topics from all anchor disciplines merge into one ranked list; the top **10** (a named constant) are kept.

Per kept topic: one search for representative papers. **There is no weekly series** — see "No sparkline" below.

### The 200-bucket horizon (why the original design was wrong)

OpenAlex returns at most **200 group buckets** per request. Measured on the live vault (Computer Science, 2026-07-25): the recent window's 200th bucket held 14 works, the prior window's held 22 — the prior window is more completely indexed, so its visibility threshold sits *higher*. A mid-sized topic therefore clears the recent list's bar while falling off the prior list's, and a join between the two grouped lists records `priorCount: 0` for it. That zero means "below our visibility horizon", not "no papers".

Because `null` growth rendered as "new" and sorted first, those artifacts filled the entire leaderboard: 60 of 200 topics were affected, all in the 14–27 recent-count band, and the bias is one-directional — the design could manufacture a "new" topic but never a decline. The live board showed ten rows all labelled "new"; its top row, "Remote-Sensing Image Classification", had actually gone 16 → 27 (a real +69%).

Hence: **never infer a prior count from a second grouped list.** Look it up per candidate. `growth: null` now means a genuine zero prior, so "new" is trustworthy, and the sparkline must use the same `primary_topic.id` filter as the growth figures so a row's chart and its badge can never disagree (before the fix, one row showed 27 papers in two weeks beside a series summing 6,245 — the series was a free-text search on the topic's name).

**Revised cost:** roughly 1 recent group-by + 1 total count per anchor, ~20 prior lookups, and ~10 representative-paper searches ≈ **~40 credits per refresh** (was 25–30). Still comfortable on a free key (1000/day); roughly two refreshes a day on the keyless tier.

`groupBy` is already a generic string parameter on the OpenAlex request builder (only `publication_date` uses it today), so grouping by topic is an extension of an existing mechanism, not a new one.

## 4. The lens (relevance + knowledge-base connection)

One pure function over the wiki bundle and the interest labels decides both lens effects:

- **Relevant marker** — a topic is marked when its name or its representative papers overlap the user's interest labels or the tags on their wiki pages (term overlap, deterministic; no LLM judgment).
- **Knowledge-base connection** — where a representative paper resolves to an existing `wiki/papers/<slug>` page, the row links to it. Only real links are rendered; **never a per-row count of matching library papers** (Tong: numerically useless), and no row is decorated when there is nothing to link to. The overview strip's "relevant rising topics" figure is a different thing — a page-level summary of the lens, not a per-row library tally.

## 5. Data flow, cost, and caching

Per refresh: load settings + user model → anchor disciplines (cached) → 1 recent-window `group_by` request per discipline → a prior-count lookup per candidate (bounded to the top 20 by recent volume) → growth ranking → per-kept-topic series + representative papers → deterministic breakout papers (reusing the existing `retrieve` movers logic) → one **strong**-tier LLM call per discipline producing qualitative text only → pure relevance/KB pass → persist.

**Cost:** roughly **35–45 OpenAlex credits per refresh** (see the revised breakdown in §3). Comfortable on a free API key (1000/day); on the keyless tier (100/day) about two refreshes per day, which the settings copy must state honestly. LLM roughly $0.05–0.2 per refresh, under the existing daily budget enforcement.

**Cache:** still `.scispark/trending/dashboard.json` with the staleness-triggered refresh and manual Refresh unchanged. The cached shape changes, so a **structure-version guard** is required: an unrecognized or old-shaped cache is treated as no cache (cold start), never a parse crash.

## 6. Degradation and error handling

Every layer degrades independently; the page is never blank:

- `group_by` fails → fall back to the existing per-week `countOpenAlexWorks` ladder.
- A topic's series fails → that row renders without a sparkline.
- Representative-paper search fails → the expanded row shows text only.
- **The LLM fails → the ranking and every number still render**, and the expanded row states the real reason (the M10 failure-honesty pattern: a `surveyError`-style field carried through to the UI, and failed structured calls still metered).
- Anchor derivation fails → fall back to the current narrow-label scope; the page still works.
- No interests at all → empty state pointing at settings.

## 7. Testing

- **Pure units:** anchor roll-up (modal field, ties, empty results); growth math (complete-window-only, zero-prior → `null`, volume floor); cross-discipline merge and ranking; relevance matching and wiki-page resolution (including the no-match case rendering nothing).
- **Component tests** (`react-dom/server`): leaderboard row (growth badge, sparkline, relevance marker, discipline chip), expanded row (LLM text, representative papers, wiki link present only when resolved), overview strip figures, and each degraded state.
- **Cache:** an old-shaped `dashboard.json` is treated as a cold start.
- **Browser manual checklist** (self-driven against a real vault, both themes): leaderboard renders with real growth numbers; expand/collapse; relevance markers; links into `/paper/[key]` and wiki pages; anchor-discipline editing round-trip; a forced-LLM-failure refresh still showing numbers.

## 8. Files (expected shape)

- **New:** `src/lib/trending/anchors.ts` (derivation), `src/lib/trending/topics.ts` (group_by-by-topic + growth ranking), `src/lib/trending/lens.ts` (relevance + KB resolution), `src/components/trending/Leaderboard.tsx`, `TopicRow.tsx`, `OverviewStrip.tsx`, `BreakoutPapers.tsx`.
- **Reworked:** `src/app/trending/page.tsx`, `src/lib/trending/dashboard.ts` (new panel/leaderboard shape + version guard), `src/lib/skills/trending.ts` (qualitative-only output re-scoped to topics), the settings modal's trending section, and the OpenAlex adapter's topic-hierarchy mapping.
- **Retired:** `FieldPanelView.tsx` and the per-field panel shape it renders (superseded by the leaderboard).

### No sparkline (decided 2026-07-25)

OpenAlex now rejects `group_by=publication_date` outright — HTTP 400 "Invalid query parameters error" in every form, while `group_by=publication_year` and `group_by=primary_topic.id` still return 200. That was the request v1.1 shipped as its headline optimization ("1 credit per field instead of 80"); it has been failing in production and silently falling back to the per-week count ladder ever since. Nothing broke, which is exactly why it went unnoticed.

Without it an 8-week sparkline costs 8 requests per topic (~80 per refresh). So the row's visual is a **prior→recent comparison bar** instead: two bars scaled to the larger of `priorCount` and `recentCount`. It costs **zero** extra requests — both numbers are already computed for the growth figure — and because it is drawn from precisely the values the badge is computed from, a row's chart can never contradict its badge. `priorCount: 0` renders an empty prior bar, which is the honest picture of "new".
