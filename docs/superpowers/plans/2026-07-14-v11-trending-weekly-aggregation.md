# v1.1 Trending Per-Week Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the retrieval-sample-derived `weeklyVolume`/`pctChange` with real OpenAlex per-week work counts, week-aligned.

**Architecture:** A new OpenAlex `countOpenAlexWorks` (reads `meta.count`, no paper fetch) + a throttled `fetchWeeklyVolume` layer; `computeFieldMetrics` gains an optional `realWeeklyVolume` (week-aligned recent/prior); `runTrendingDashboard` wires a `countFn` dep alongside `searchFn`, falling back to the sample series on any count failure. Spec: `docs/superpowers/specs/2026-07-14-v11-trending-weekly-aggregation-design.md`.

**Tech Stack:** TypeScript, vitest, Next.js route handlers.

## Global Constraints

- Real numbers only (deterministic, from OpenAlex counts — LLM never emits a stat).
- Graceful fallback: any count failure → `fetchWeeklyVolume` returns `null` → orchestrator uses the existing sample-derived series (never worse than M10).
- Browser = UI only (M11): the orchestrator + countFn run server-side; the trending page is unchanged (it already fetches the dashboard via the skills API).
- `fetchWithTimeout` (M12) wraps the count fetch; keyless OpenAlex only (arXiv has no cheap count endpoint).
- Week buckets are ISO Monday UTC, shared between the fetch window and the chart (one helper, no drift).

---

### Task 1: OpenAlex count capability

**Files:**
- Modify: `src/lib/papers/openalex.ts` (add `toDate` to `OpenAlexQuery` + the filter; add `meta` to the response type; add `countOpenAlexWorks`)
- Test: `src/lib/papers/__tests__/openalex.test.ts` (extend)

**Interfaces:**
- `OpenAlexQuery` gains `toDate?: string`.
- `export async function countOpenAlexWorks(q: { query: string; fromDate: string; toDate: string }, deps?: OpenAlexDeps): Promise<number>`.

**Details:** Read `src/lib/papers/openalex.ts` in full first (its `buildUrl`, `OpenAlexWorksResponse`, `fetchWithTimeout` usage, `PaperSourceError`). The `filter` param must combine both dates comma-separated: `from_publication_date:X,to_publication_date:Y`. `buildUrl` currently only sets `from_publication_date` when `q.fromDate` — extend it to append `to_publication_date` when `q.toDate` (build the filter as a joined array of the present clauses).

- [ ] **Step 1: Write failing tests**

```ts
// in openalex.test.ts — add:
import { countOpenAlexWorks, searchOpenAlex } from "../openalex"

function countFetch(meta: unknown, status = 200) {
  return vi.fn(async (url: string) => {
    // assert per_page=1 + both date filters present
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
      json: async () => ({ results: [], meta }), text: async () => "" }
  }) as unknown as typeof fetch
}

describe("countOpenAlexWorks", () => {
  it("returns meta.count and requests per_page=1 with from+to date filter", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => {
      calledUrl = String(url)
      return new Response(JSON.stringify({ results: [], meta: { count: 123 } }), { status: 200 })
    }) as unknown as typeof fetch
    const n = await countOpenAlexWorks({ query: "nlp", fromDate: "2026-07-06", toDate: "2026-07-12" }, { fetchFn })
    expect(n).toBe(123)
    expect(calledUrl).toContain("per_page=1")
    expect(decodeURIComponent(calledUrl)).toContain("from_publication_date:2026-07-06")
    expect(decodeURIComponent(calledUrl)).toContain("to_publication_date:2026-07-12")
  })

  it("returns 0 when meta/count is missing", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch
    expect(await countOpenAlexWorks({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-12" }, { fetchFn })).toBe(0)
  })

  it("throws PaperSourceError on a non-200", async () => {
    const fetchFn = (async () => new Response("", { status: 429 })) as unknown as typeof fetch
    await expect(countOpenAlexWorks({ query: "x", fromDate: "a", toDate: "b" }, { fetchFn })).rejects.toThrow()
  })
})

describe("searchOpenAlex toDate", () => {
  it("adds to_publication_date to the filter when toDate is set", async () => {
    let calledUrl = ""
    const fetchFn = (async (url: string) => { calledUrl = String(url); return new Response(JSON.stringify({ results: [] }), { status: 200 }) }) as unknown as typeof fetch
    await searchOpenAlex({ query: "x", fromDate: "2026-01-01", toDate: "2026-02-01" }, { fetchFn })
    expect(decodeURIComponent(calledUrl)).toContain("from_publication_date:2026-01-01")
    expect(decodeURIComponent(calledUrl)).toContain("to_publication_date:2026-02-01")
  })
})
```

- [ ] **Step 2: Run → FAIL. Implement:** add `toDate?` to `OpenAlexQuery`; in `buildUrl` build the filter from the present date clauses; add `meta?: { count?: number }` to `OpenAlexWorksResponse`; add `countOpenAlexWorks` (per_page fixed at 1 via a dedicated URL builder or reuse buildUrl with `limit: 1`; `fetchWithTimeout`; non-ok → `PaperSourceError`; `body.meta?.count ?? 0`).
- [ ] **Step 3:** `npx vitest run src/lib/papers && npx tsc --noEmit`; full suite green (existing openalex tests unaffected — `toDate` is additive).
- [ ] **Step 4: Commit** `feat(openalex): countOpenAlexWorks + to_publication_date filter`

---

### Task 2: Shared week helper + fetchWeeklyVolume

**Files:**
- Create: `src/lib/trending/weeks.ts` (extract `isoWeekStart` + `buildWeekStarts` from metrics.ts)
- Modify: `src/lib/trending/metrics.ts` (import the shared helper instead of its local copy)
- Create: `src/lib/trending/weekly-volume.ts`
- Test: `src/lib/trending/__tests__/weeks.test.ts`, `src/lib/trending/__tests__/weekly-volume.test.ts`

**Interfaces:**
- `weeks.ts`: `export function isoWeekStart(d: Date): string` (Monday UTC, YYYY-MM-DD); `export function buildWeekStarts(now: Date, weeks: number): string[]` (oldest→newest, ending on now's week, length `weeks`).
- `weekly-volume.ts`: `export type CountFn = (q: { query: string; fromDate: string; toDate: string }) => Promise<number>`; `export async function fetchWeeklyVolume(countFn: CountFn, query: string, weekStarts: string[]): Promise<VolumePoint[] | null>`.

**Details:**
- Extract `isoWeekStart` and the `weekStarts` loop from `metrics.ts` into `weeks.ts` verbatim (same Monday-UTC logic), and have `metrics.ts` import them — its existing tests must stay green (behavior identical).
- `fetchWeeklyVolume`: for each `weekStart`, count `[weekStart, weekStart+6 days]` (compute the inclusive Sunday end). Throttle with a shared concurrency limiter (cap 4 — copy the tiny `createLimiter` from `src/lib/spark/scoop.ts`, or import if exported; if not exported, a local copy is fine — note it). If ANY count throws, return `null` (catch at the top level). Otherwise return `VolumePoint[]` in `weekStarts` order.

- [ ] **Step 1: weeks.test.ts** — `isoWeekStart` for a Sunday maps to the previous Monday; `buildWeekStarts(2026-07-14, 8)` → 8 dates ending `2026-07-13` (that week's Monday), oldest first. **Step 2:** extract + wire metrics; run `npx vitest run src/lib/trending/__tests__/metrics.test.ts` (stays green) + weeks test.
- [ ] **Step 3: weekly-volume.test.ts** —
```ts
it("issues one count per week, aligned to weekStarts, returns VolumePoint[]", async () => {
  const seen: Array<{fromDate:string,toDate:string}> = []
  const countFn = async (q) => { seen.push({fromDate:q.fromDate,toDate:q.toDate}); return q.fromDate === "2026-07-06" ? 5 : 2 }
  const vol = await fetchWeeklyVolume(countFn, "nlp", ["2026-06-29","2026-07-06"])
  expect(vol).toEqual([{weekStart:"2026-06-29",count:2},{weekStart:"2026-07-06",count:5}])
  expect(seen[1]).toEqual({fromDate:"2026-07-06",toDate:"2026-07-12"}) // Mon..Sun inclusive
})
it("returns null if any week's count fails (fallback signal)", async () => {
  const countFn = async (q) => { if (q.fromDate==="2026-07-06") throw new Error("429"); return 1 }
  expect(await fetchWeeklyVolume(countFn, "nlp", ["2026-06-29","2026-07-06"])).toBeNull()
})
it("caps concurrency (peak <= 4) but issues every query", async () => { /* many weekStarts; track active count */ })
```
Implement. **Step 4:** `npx vitest run src/lib/trending && npx tsc --noEmit` green.
- [ ] **Step 5: Commit** `feat(trending): shared week helper + fetchWeeklyVolume (real per-week OpenAlex counts, throttled)`

---

### Task 3: Metrics real-volume input + orchestrator + route wiring

**Files:**
- Modify: `src/lib/trending/metrics.ts` (optional `realWeeklyVolume` → week-aligned recent/prior), `src/lib/trending/dashboard.ts` (countFn dep; call fetchWeeklyVolume; pass through), the trending routes `src/app/api/skills/trending/{refresh,auto-refresh}/route.ts` (build countFn server-side) + `src/lib/server/skill-route.ts` (`setSkillTestOverrides` gains an optional `countFn`)
- Test: extend `src/lib/trending/__tests__/{metrics,dashboard}.test.ts`, `src/lib/server/__tests__/trending-api.test.ts`

**Interfaces:**
- `computeFieldMetrics(candidates, { now, weeks?, realWeeklyVolume? })`: when `realWeeklyVolume` present → `weeklyVolume = realWeeklyVolume`; `paperCountRecent = sum(last 2 buckets)`, `paperCountPrior = sum(2 before that)`, `pctChange = prior===0 ? null : (recent-prior)/prior`. When absent → unchanged sample-derived behavior. `topMovers`/`topVenues` unchanged (always from the sample).
- `RunTrendingOpts` gains `countFn?: CountFn`. Per field: `const weekStarts = buildWeekStarts(at, WEEKS)`; `const realVol = opts.countFn ? await fetchWeeklyVolume(opts.countFn, field.label, weekStarts).catch(() => null) : null`; `computeFieldMetrics(candidates, { now: at, realWeeklyVolume: realVol ?? undefined })`. (Keep the existing per-field try/catch so a volume failure degrades that panel gracefully — but fetchWeeklyVolume already returns null on failure, so the fallback is the sample series, not a dropped panel.)

**Details:** Read `dashboard.ts`'s per-field loop (the `const at = now()` window-sync from M10 T5) and thread `weekStarts`/`realVol` through it. The routes build `countFn = getSkillTestOverrides().countFn ?? ((q) => countOpenAlexWorks(q))`. Extend `setSkillTestOverrides`/`getSkillTestOverrides` to carry `countFn`.

- [ ] **Step 1: metrics test** — `computeFieldMetrics` with `realWeeklyVolume: [{...×8}]`: weeklyVolume is that series verbatim; recent = sum(last 2), prior = sum(2 before), pctChange correct; pctChange null when prior 2 buckets sum 0; without realWeeklyVolume the old tests still pass.
- [ ] **Step 2: dashboard test** — a fake `countFn` returning a known series → panel.metrics.weeklyVolume is the real series, pctChange week-aligned; a `countFn` that throws (→ fetchWeeklyVolume null) → falls back to sample-derived series (panel still produced, metrics present).
- [ ] **Step 3: trending-api test** — `setSkillTestOverrides({ providerOverride, searchFn, countFn })`; refresh route result carries the real weekly series.
- [ ] **Step 4:** `npx vitest run src/lib/trending src/lib/server && npx tsc --noEmit && npm run build` green; full suite green.
- [ ] **Step 5: Commit** `feat(trending): real per-week volume + week-aligned pctChange wired through orchestrator + routes`

---

### Task 4: Live gate + docs

**Files:**
- Modify: `src/lib/trending/__tests__/live-trending.test.ts` (assert non-degenerate volume), `docs/design/*` trending caveat + CLAUDE.md note
- (docs only + one test assertion)

**Details:** In the live gate, after the trending refresh, assert `panel.metrics.weeklyVolume.filter(v => v.count > 0).length >= 2` for the NLP field (proving real multi-week counts, not `[0..0,N]`). Keep existing shape/cost assertions. Update the M10/CLAUDE.md caveat: volume is now real OpenAlex per-week work counts (keyword-matched, OpenAlex coverage), pctChange week-aligned.

- [ ] **Step 1:** update the live-gate assertion; verify it still SKIPS cleanly without env; full suite + tsc + build green. **Step 2:** docs edits. **Step 3: Commit** `test(trending): live gate asserts non-degenerate weekly volume; docs note real counts`
- [ ] **Step 4 (controller):** run the live gate vs GMI+OpenAlex; confirm a non-degenerate weekly series + record it.

---

## Self-Review

**Spec coverage:** OpenAlex count (T1); week helper + fetchWeeklyVolume (T2); metrics real-volume + orchestrator + routes + fallback (T3); live gate + docs (T4). Graceful fallback preserved (fetchWeeklyVolume→null→sample series). Week-aligned recent/prior per the approved semantics change. ✓

**Placeholder scan:** exact interfaces/filter strings/route files named; code shown for the pure/logic pieces; T3/T4 direct the implementer to read the real dashboard loop + routes. No TBDs.

**Type consistency:** `CountFn` (T2) consumed by T3 orchestrator + routes; `countOpenAlexWorks` (T1) matches `CountFn`'s shape; `isoWeekStart`/`buildWeekStarts` (T2) shared by metrics + weekly-volume + dashboard; `realWeeklyVolume` (T3) is `VolumePoint[]` from `metrics.ts`; `setSkillTestOverrides` gains `countFn`.

---

## Addendum (2026-07-15, post-review follow-ups — approved by Tong)

Live-gate discovery: OpenAlex now runs a credit-priced API — keyless $0.10/day (~100 searches at 10 credits each), free-API-key $1/day; `group_by` requests cost 1 credit; `api_key` query param; resets midnight UTC. Follow-ups:

### Task 5: group_by weekly volume (1 request/field instead of 8) + OPENALEX_API_KEY

**Files:** modify `src/lib/papers/openalex.ts` (add `apiKey?` to deps→buildUrl `api_key` param; add `groupWorksByPublicationDate({query, fromDate, toDate}, deps): Promise<Array<{key: string; count: number}>>` — one GET `works?search=…&filter=from_publication_date:X,to_publication_date:Y&group_by=publication_date&per_page=200`, parse the `group_by: [{key, key_display_name, count}]` response array), `src/lib/papers/node-search.ts` (helpers read `OPENALEX_API_KEY`; add `nodeGroupFn()`), `src/lib/trending/weekly-volume.ts` (optional `groupFn` param: try ONE grouped call first, map daily `key`s → ISO weeks via `isoWeekStart`, zero-fill the weekStarts buckets; on any grouped error/absence fall back to the existing per-week `countFn` path, then `null`→sample), `src/lib/trending/dashboard.ts` + routes + `setSkillTestOverrides` (thread optional `groupFn`), `.env.example` (`OPENALEX_API_KEY=`). Tests: grouped happy path (daily keys summed into correct ISO weeks, zero-filled), grouped-fails→countFn fallback, api_key param on the wire, existing tests green.

### Task 6 (docs): update `docs/design/03-backend.md` OpenAlex politeness note to the credit-quota model + per-user local quota argument; live-gate report note.
