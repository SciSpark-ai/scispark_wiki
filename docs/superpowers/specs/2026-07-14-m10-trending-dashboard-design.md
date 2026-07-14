# M10 — Personalized Field-Trends Dashboard (Design)

**Status:** approved by Tong 2026-07-14. Supersedes the original roadmap M10 ("public trending + cron + blob + marketing capture") — see *Divergence from prior design* below.

## Goal

A personalized, fixed-layout dashboard — **"what's big happening in your field"** — scoped to the user's fixed research-area sub-fields, refreshed on a daily/weekly cadence, combining **deterministic quantitative signals + visualizations** with a **qualitative LLM trend survey**. Local-first, BYOK, reusing the M5 feed and M8 viz patterns. No new server infrastructure.

## Concept (Tong, 2026-07-14)

- After onboarding we already know the user's research area(s) at the **sub-field level**; these are **fixed** (change only when the user edits them) — unlike the feed, the trending dashboard does not need per-refresh interest dynamics.
- An agent **gathers trend info on a schedule**; the **page layout is fixed**, the agent fills it in.
- The dashboard should have **real numbers and visualizations**, not just prose. All numbers are **computed deterministically from retrieved papers — never emitted by the LLM** (no hallucinated statistics). The LLM writes only the qualitative layer (notable-paper "whys", emerging topics, momentum narrative).

## Divergence from prior design (what is dropped)

The original roadmap M10 assumed a **public/anonymous** trending page that doubled as a marketing funnel, produced by a **server-side Vercel cron** (SciSpark's key, user-independent) writing to **Vercel Blob**, plus **`/api/register` + Supabase** email capture. Tong reframed trending as a **personalized** per-user dashboard; without a register-gated funnel, a generic public page isn't worth its cost. Because the dashboard is personalized and runs on the user's BYOK in a local-first browser app, a server cron is architecturally wrong (it would need the user's key server-side). Therefore this milestone **drops**: the public/anonymous page, the Vercel cron, Vercel Blob, `/api/register`, and Supabase. None are built in M10.

`06-roadmap.md` (M10 row) and the trending sections of `01-product.md` / `03-backend.md` / `04-agent-harness.md` are reconciled to this model as part of implementation (a documentation task in the plan). The public/cron model remains a documented **v2 path** (once a backend + accounts exist, a server-side scheduler and a shared/anonymous variant can be added).

## Scheduling in v1 (staleness-triggered, not a server cron)

A browser cannot run a schedule while closed without a backend. In v1 the "daily/weekly cron" is realized as a **staleness-triggered refresh**, identical in shape to the M5 feed cache:

- The dashboard is cached in the vault; each panel/dashboard carries `generatedAt`.
- A cadence setting (default **weekly**; `daily` also offered) lives in `.scispark/settings.json`.
- On trending-page load **and** on app-open (via the existing M7 trigger surface), if the cache is older than the cadence, the harness refreshes in the background (budget-aware).
- A manual **Refresh** button always allows an immediate refresh.
- A true server-side scheduler is a clean v2 add once there is a backend + accounts.

## Architecture

Two layers, cleanly separated (mirrors M8): a **deterministic data layer** (`src/lib/trending/*.ts`, pure, thoroughly unit-tested) and a **fixed presentation layer** (`src/components/trending/*.tsx` + `/trending` page). The single LLM unit is a persona-free skill; the orchestrator owns retrieval, metric computation, storage, and staleness (blessed pattern: skills are pure LLM units, orchestrators own storage/retrieval).

### Data flow

```
interests.md  →  trackedFields (fixed, editable)
      │
      ▼  per field
  retrieveFieldCandidates(searchFn, field, now)   → recent papers + citation movers
      │
      ├─► computeFieldMetrics(papers, now)   [DETERMINISTIC] → counts, %Δ, weekly series, top movers/venues
      │
      └─► trendingSkill(field, papers)       [LLM, qualitative] → notablePapers whys, emergingTopics, momentum
      │
      ▼
  assemble FieldPanel { field, metrics, series, survey, generatedAt }
      │
      ▼
  TrendingDashboard { panels[], generatedAt }  →  cache: .scispark/trending/dashboard.json
      │
      ▼
  /trending page renders fixed layout: one panel per field (charts + numbers + narrative)
```

## Components & interfaces

### 1. Tracked fields — `src/lib/trending/fields.ts`

```ts
export interface TrackedField { slug: string; label: string }         // research-area granularity, e.g. {slug:"nlp", label:"Natural Language Processing"}
export function deriveTrackedFields(interestsMarkdown: string): TrackedField[]   // parse interests.md → up to 3 research-area fields
export const MAX_TRACKED_FIELDS = 3
```

Tracked fields are **seeded** from `interests.md` at onboarding-complete into a stable list persisted in `.scispark/settings.json` (`trending.fields`), so memory-consolidation drift in `interests.md` does not silently move them. The user edits them in settings/profile. If none are seeded/configured, `deriveTrackedFields` re-derives from the current `interests.md` as a fallback.

### 2. Retrieval — `src/lib/trending/retrieve.ts`

```ts
export interface TrendingCandidates { recent: PaperRecord[]; movers: PaperRecord[] }
export async function retrieveFieldCandidates(
  searchFn: SearchFn, field: TrackedField, opts: { now: Date; recentWindowDays?: number; limit?: number },
): Promise<TrendingCandidates>
```

Uses the same injected `SearchFn` shape as M5/M9 (arxiv + openalex, keyless-safe). `recent` = papers in the last `recentWindowDays` (default 14) for the field; `movers` = high-citation / high-velocity papers for the field. A failed source contributes `[]` (never fails the whole panel). Reuses the M9 arXiv retry/backoff + a shared concurrency cap.

### 3. Deterministic metrics — `src/lib/trending/metrics.ts`

```ts
export interface VolumePoint { weekStart: string; count: number }
export interface FieldMetrics {
  paperCountRecent: number            // count in the recent window
  paperCountPrior: number             // count in the immediately preceding window (same length)
  pctChange: number | null            // (recent - prior) / prior, null when prior === 0
  weeklyVolume: VolumePoint[]         // publication volume bucketed by ISO week (for the chart)
  topMovers: Array<{ paper: PaperRecord; citationCount: number }>   // by citationCount desc
  topVenues: Array<{ venue: string; count: number }>
}
export function computeFieldMetrics(papers: PaperRecord[], opts: { now: Date; recentWindowDays?: number; weeks?: number }): FieldMetrics
```

**Pure and deterministic.** Every number is derived from the papers' own metadata (`date`/`year`, `citationCount`, `venue`). The LLM never produces a statistic. Thoroughly unit-tested (window boundaries, empty input, missing-date handling, ISO-week bucketing, `pctChange` null-on-zero-prior).

### 4. Trending Skill — `src/lib/skills/trending.ts`

Pure `strong`-tier LLM unit, **persona-free** (analysis skill). Untrusted paper text fenced + neutralized via the shared `fence()` helper.

```ts
export const TrendingSurveySchema = z.object({
  notablePapers: z.array(z.object({ title: z.string().min(1), why: z.string().min(1) })).min(1).max(6),
  emergingTopics: z.array(z.object({ topic: z.string().min(1), why: z.string().min(1) })).min(1).max(5),
  momentum: z.string().min(1),   // narrative: what is moving in this field right now
})
export const trendingSkill: SkillDefinition<TrendingSkillInput, z.infer<typeof TrendingSurveySchema>>
```

Input: the field + the retrieved candidates (titles/abstracts/years). Output: the qualitative survey only.

### 5. Orchestrator — `src/lib/trending/dashboard.ts`

```ts
export interface FieldPanel { field: TrackedField; metrics: FieldMetrics; survey: TrendingSurvey; generatedAt: string }
export interface TrendingDashboard { panels: FieldPanel[]; generatedAt: string }
export const DASHBOARD_CACHE_PATH = ".scispark/trending/dashboard.json"
export type Cadence = "daily" | "weekly"

export async function runTrendingDashboard(storage: VaultStorage, opts: {
  fields: TrackedField[]; searchFn: SearchFn; settings?: LLMSettings;
  providerOverride?: Partial<Record<Tier, LLMProvider>>; now?: () => Date;
  onProgress?: (field: string) => void;
}): Promise<TrendingDashboard>                                    // retrieves, computes metrics, runs skill per field, caches, logs event

export async function loadDashboard(storage: VaultStorage): Promise<TrendingDashboard | null>
export function isStale(dashboard: TrendingDashboard | null, cadence: Cadence, now: Date): boolean
```

Per field: `retrieveFieldCandidates` → `computeFieldMetrics` (deterministic) → `trendingSkill` (qualitative) → assemble `FieldPanel`. A per-field failure degrades that panel (retained with an error marker or dropped) without failing the dashboard. Accumulates cost; **budget-aware** (respects the harness daily budget like the feed — degrade/defer when exceeded). Writes the cache atomically and logs a Tier-1 `trending_refresh` event (`{ fields, costUsd }`).

### 6. Charts & page — `src/components/trending/*` + `src/app/trending/page.tsx`

Deterministic SVG charts using `d3-scale`/`d3-shape` (already deps; same approach as M8's `TimelineView`), pure props → SVG:

- `PublicationVolumeChart` — bar/line of `weeklyVolume`.
- `MomentumStat` — `paperCountRecent` + `pctChange` with an up/down indicator.
- `TopMoversList` — `topMovers` (title + citation count, link to reader/digest).
- `EmergingTopicsList` / notable-papers list — the LLM survey.

`/trending` is a **fixed layout**: one `FieldPanel` per tracked field (momentum stat + volume chart + top movers + emerging topics + momentum narrative), an "Updated X ago" header, a manual **Refresh**, and a background auto-refresh when stale. A **Trending** entry is added to the Sidebar. Errors surface via the existing `LlmErrorMessage`; retrieval failures show a per-panel "couldn't refresh this field" state.

### 7. Settings

`.scispark/settings.json` gains `trending: { fields: TrackedField[]; cadence: Cadence }` (cadence default `weekly`). Editable in settings/profile UI (small).

## Error handling

- Per-field retrieval failure → that panel renders a "couldn't refresh" state; other panels are unaffected.
- LLM error on a field's survey → panel keeps its deterministic metrics/charts and shows the survey error inline (numbers still useful without the narrative).
- Budget exceeded mid-refresh → stop, keep completed panels, surface the "refresh manually to spend more" affordance (feed idiom).
- Missing `interests.md` / no tracked fields → empty-state prompting the user to set fields (link to settings).

## Testing

- **Unit (pure, thorough):** `deriveTrackedFields` (parse variants), `computeFieldMetrics` (window boundaries, empty, missing dates, ISO-week buckets, null pctChange), `isStale` (cadence boundaries), chart prop→SVG helpers if any pure geometry is extracted.
- **Unit (mocked):** `retrieveFieldCandidates` (fake searchFn incl. source failure), `trendingSkill` (MockProvider), `runTrendingDashboard` (memory vault + MockProvider + fake searchFn: happy path caches a dashboard with real metrics + survey, per-field failure degrades one panel, event logged, cost summed).
- **Live gate (env-gated, skips without `LIVE_LLM_*`):** run `runTrendingDashboard` for one sample field vs GMI; assert the panel carries **real deterministic metrics** (counts/series derived from retrieved papers) and a schema-valid survey, cost under a loose bound; log a sample. Uses the M9 node `searchFn` idiom.
- Page/components browser-verified (fixed layout, charts render, refresh flow), not unit-tested — listed as manual-check items.

## Out of scope (v1)

Server-side scheduler/cron; public/anonymous trending; Vercel Blob; `/api/register` / Supabase; feeding trending output into the Feed's stage-1 candidates (a clean follow-up, noted but deferred); cross-field "meta" trends. `trending.get` tool + Feed integration deferred with the public model.
