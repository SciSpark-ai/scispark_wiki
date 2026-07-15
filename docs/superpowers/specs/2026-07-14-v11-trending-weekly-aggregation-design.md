# v1.1 — Trending Per-Week Aggregation (Design)

**Status:** approved by Tong 2026-07-14 (week-aligned recent/prior confirmed). A focused post-v1 enhancement, not a milestone.

## Problem

M10's trending dashboard computes `weeklyVolume` and `pctChange` in `computeFieldMetrics` by bucketing the **retrieval sample** — the ≤50 papers (`limit` 25 × arxiv+openalex, date-descending) that `retrieveFieldCandidates` returns. Because retrieval returns only the most recent papers, older weeks are under-sampled: the volume chart is near-zero except the current week, and `pctChange` is usually `null` (the prior window has no sampled papers). The numbers are deterministic but measure "how many of the top keyword hits fell in each week," not real field output (the M10 whole-branch review flagged this; live gate showed `[0,0,0,0,0,0,0,25]`).

## Fix

Replace the sample-derived weekly series with **real OpenAlex work counts per week**. `TrackedField` carries only `{slug, label}` (no OpenAlex concept id), so counts use OpenAlex keyword `search=` — the same query retrieval already uses — bounded by publication-date filters, reading `meta.count` with `per_page=1` (never fetching the papers).

### 1. OpenAlex count capability — `src/lib/papers/openalex.ts`

- Extend the query filter to support a `toDate` (add `to_publication_date:<toDate>` alongside the existing `from_publication_date`).
- Add `export async function countOpenAlexWorks(q: { query: string; fromDate: string; toDate: string }, deps?: OpenAlexDeps): Promise<number>` — builds a `/works?search=<query>&filter=from_publication_date:X,to_publication_date:Y&per_page=1` request and returns `response.meta.count` (0 on a missing/invalid meta). Wrapped in the M12 `fetchWithTimeout`; a failure throws (caller decides fallback). Injectable `fetchFn` for tests.

### 2. Weekly-volume fetch layer — `src/lib/trending/weekly-volume.ts`

- `export async function fetchWeeklyVolume(countFn, query: string, weekStarts: string[]): Promise<VolumePoint[] | null>` — where `countFn` matches `countOpenAlexWorks`'s shape (injected). For each `weekStart` (ISO Monday), issue one count query for `[weekStart, weekStart+6d]` (inclusive), **throttled** (shared concurrency limiter, cap ~4, same pattern as the M9 scoop fan-out). Returns `VolumePoint[]` aligned 1:1 with `weekStarts`. If **any** count query fails (rate limit / down), return `null` so the orchestrator falls back to the sample-derived series — never worse than today. Pure w.r.t. storage (countFn injected).
- The `weekStarts` come from the same ISO-week logic `metrics.ts` already uses (Monday UTC, `weeks` back ending at the current week) — extract/share that helper so the fetch window and the chart buckets align exactly.

### 3. Metrics + orchestrator wiring

- `computeFieldMetrics` (`src/lib/trending/metrics.ts`) gains an optional `realWeeklyVolume?: VolumePoint[]` input. When present: use it verbatim as `weeklyVolume`, and compute `paperCountRecent`/`paperCountPrior`/`pctChange` from it **week-aligned** — recent = sum of the last 2 weekly buckets, prior = sum of the 2 before, `pctChange = (recent-prior)/prior` (null when prior is 0). When absent (fallback): the existing sample-derived behavior is unchanged. `topMovers`/`topVenues` are always from the retrieval sample (unchanged — they need real papers).
- `runTrendingDashboard` (`src/lib/trending/dashboard.ts`): after `retrieveFieldCandidates`, derive the field's `weekStarts` and call `fetchWeeklyVolume(countFn, field.label, weekStarts)`; pass the result (or `null`) into `computeFieldMetrics`. `countFn` is a new orchestrator dep (`countOpenAlexWorks` in the app / server route; injectable for tests, mirroring `searchFn`). The per-storage in-flight guard and event logging are unchanged.
- The server trending routes (`/api/skills/trending/*`) build `countFn` server-side alongside `searchFn` (like `nodeSearchFn`); a matching test override in `setSkillTestOverrides`.

### 4. Live gate + docs

- Update `live-trending.test.ts` to assert the weekly series is **non-degenerate** (more than one non-zero week for a broad field like NLP, i.e. not `[0,…,0,N]`), proving real per-week counts. Keep the loose cost/shape assertions.
- CLAUDE.md / the M10 spec caveat: volume now reflects real OpenAlex per-week work counts (OpenAlex coverage, keyword-matched), not the retrieval sample.

## Semantics change (approved)

"Recent" vs "prior" become **week-aligned** (last 2 complete weekly buckets vs the 2 before) instead of rolling 14-day windows, so `pctChange` derives from — and matches — the weekly chart the user sees. Slightly changes M10's rolling-window definition; more intuitive for a weekly view and costs no extra requests.

## Error handling

- A single failed weekly count → `fetchWeeklyVolume` returns `null` → orchestrator falls back to the sample-derived series (today's behavior). The panel always renders.
- OpenAlex-only volume is a documented limitation (arXiv has no cheap count endpoint); it's a real, meaningful signal, just OpenAlex-scoped.

## Testing

Unit: `countOpenAlexWorks` (meta.count parse, timeout, date filter shape) against a fake fetch; `fetchWeeklyVolume` (per-week queries issued, aligned output, throttle cap, any-failure→null); `computeFieldMetrics` with `realWeeklyVolume` (week-aligned recent/prior/pctChange, null-on-zero-prior, verbatim series); orchestrator wiring (real counts flow through; countFn failure → fallback series). Route tests via `setSkillTestOverrides` (countFn override). Live gate asserts non-degenerate volume vs GMI+OpenAlex.

## Out of scope

Per-source volume (arXiv counts); OpenAlex `group_by=publication_date` single-request optimization (per-week count queries are definitely-supported and cheap enough); concept-id-based fields (retrieval stays keyword-based); backfilling historical volume beyond the 8-week window.
