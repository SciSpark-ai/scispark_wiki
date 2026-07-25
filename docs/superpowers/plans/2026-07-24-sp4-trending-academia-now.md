# SP4 — Academia Right Now (Trending Rework) Implementation Plan

**Status (2026-07-25):** Built — 11 tasks complete and reviewed, plus five corrections forced by live runs against the real OpenAlex API. The plan's §3/§4 growth arithmetic is SUPERSEDED: raw two-window count ratios proved invalid (200-bucket horizon, then indexing back-fill), and growth is now share-of-corpus with prior counts looked up per topic. Weekly sparklines were dropped entirely (`group_by=publication_date` no longer exists upstream) in favour of prior→recent comparison bars. See the spec for the corrected design.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/trending`'s per-narrow-field panels with an "Academia Right Now" board: a dense, cross-discipline leaderboard of genuinely accelerating topics — real growth numbers from OpenAlex `group_by`, sparklines, discipline chips, a relevance marker from the user's interests, and per-topic LLM interpretation on expand.

**Architecture:** Every number is deterministic (two `group_by` requests per anchor discipline over complete, week-aligned windows); the LLM is confined to qualitative text and is never given counts to echo. Anchor disciplines are derived from the user's narrow interest labels via one `group_by=primary_topic.field.id` request each (1 credit), cached in trending settings and overridable. New pure libs (`anchors`, `topics`, `lens`) hold all logic and all unit tests; the orchestrator owns storage; components are thin.

**Tech Stack:** Next.js 16 App Router (client page + existing `/api/skills/trending/*` routes), Tailwind v4 SP1 tokens, zod-validated skill output, vitest + `react-dom/server` for component tests.

**Spec:** `docs/superpowers/specs/2026-07-24-sp4-trending-academia-now-design.md`

## Global Constraints

- **Zero LLM-emitted numbers.** Every figure on the page comes from OpenAlex counts. The skill is never given counts in its input, so it cannot echo them.
- Windows are **week-aligned and complete**: recent = the last 2 complete ISO weeks; prior = the 2 complete weeks before those; the in-progress week is excluded from both.
- **Volume floor `MIN_RECENT_COUNT = 5`**, leaderboard length `MAX_LEADERBOARD_TOPICS = 10` — named constants, each defined in exactly one place.
- Growth is `(recent − prior) / prior`, and **`null` when prior is 0** — rendered as "new", never as ∞ or a fabricated percentage.
- **No per-row library counts.** The knowledge-base connection is a link to a real `wiki/papers/<slug>` page or nothing at all.
- Every layer degrades independently; a failure never blanks the page. A failed LLM call still renders the full ranking and states its real reason (M10 failure-honesty), and failed structured calls stay metered.
- All colors/typography via SP1 semantic tokens — the no-raw-hex guard and the browser-purity gate must stay green.
- Titles render through `displayTitle` (`src/lib/papers/title.ts`); wiki links through `wikiHref` (`src/lib/wiki/href.ts`); paper links to `/paper/<slug>`.
- No new dependencies. `npm run lint` adds nothing over the pre-existing 8-error/5-warning baseline. `npm run build` passes.
- New `dangerouslySetInnerHTML` is banned unless the wrapper object is referentially stable; never side-effect inside a JSX expression (both are documented repo footguns).

---

### Task 1: OpenAlex generic group-by + topic/field grouping

**Files:**
- Modify: `src/lib/papers/openalex.ts`
- Modify: `src/lib/papers/node-search.ts`
- Test: `src/lib/papers/__tests__/openalex-group.test.ts` (new)

**Note for the implementer:** in one earlier session `src/lib/papers/openalex.ts` returned `EPERM: operation not permitted` on read. If that happens to you, report **BLOCKED** with the exact error rather than guessing at the file's contents.

**Interfaces:**
- Consumes: the existing private request builder in `openalex.ts` (it already accepts a generic `groupBy` string option and forces `per_page` to the group-by page size — read `groupWorksByPublicationDate` and the builder above it first and follow that shape exactly).
- Produces:

```ts
export interface GroupEntry { key: string; label: string; count: number }
export async function groupWorksByTopic(
  q: { query: string; fromDate: string; toDate: string },
  opts?: { mailto?: string; apiKey?: string },
): Promise<GroupEntry[]>
export async function groupWorksByTopicField(
  q: { query: string; fromDate: string; toDate: string },
  opts?: { mailto?: string; apiKey?: string },
): Promise<GroupEntry[]>
```

and in `node-search.ts`, mirroring the existing `nodeGroupFn()` exactly (same env reads: `OPENALEX_MAILTO`, `OPENALEX_API_KEY`):

```ts
export type TopicGroupFn = (q: { query: string; fromDate: string; toDate: string }) => Promise<GroupEntry[]>
export function nodeTopicGroupFn(): TopicGroupFn
export function nodeTopicFieldGroupFn(): TopicGroupFn
```

Both grouping calls use `group_by=primary_topic.id` and `group_by=primary_topic.field.id` respectively, with the same date filtering, retry/backoff, and `AbortController` timeout the existing OpenAlex calls use. `key` is the OpenAlex id, `label` is `key_display_name`. Entries whose `key_display_name` is missing or whose key is the literal `"unknown"` are dropped (OpenAlex emits an "unknown" bucket for unclassified works — it is never a real topic).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest"
import { groupWorksByTopic, groupWorksByTopicField } from "../openalex"

function fetchReturning(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

describe("groupWorksByTopic", () => {
  it("requests group_by=primary_topic.id with the date range and maps entries", async () => {
    const fetchFn = fetchReturning({
      group_by: [
        { key: "https://openalex.org/T10123", key_display_name: "Auditory Perception", count: 42 },
        { key: "https://openalex.org/T10456", key_display_name: "Speech Processing", count: 17 },
      ],
    })
    const out = await groupWorksByTopic(
      { query: "neuroscience", fromDate: "2026-07-06", toDate: "2026-07-19" },
      { fetchFn } as never,
    )
    const url = String(fetchFn.mock.calls[0][0])
    expect(url).toContain("group_by=primary_topic.id")
    expect(url).toContain("from_publication_date%3A2026-07-06")
    expect(url).toContain("to_publication_date%3A2026-07-19")
    expect(out).toEqual([
      { key: "https://openalex.org/T10123", label: "Auditory Perception", count: 42 },
      { key: "https://openalex.org/T10456", label: "Speech Processing", count: 17 },
    ])
  })

  it("drops the unknown bucket and entries with no display name", async () => {
    const fetchFn = fetchReturning({
      group_by: [
        { key: "unknown", key_display_name: "unknown", count: 99 },
        { key: "https://openalex.org/T1", count: 5 },
        { key: "https://openalex.org/T2", key_display_name: "Real Topic", count: 3 },
      ],
    })
    const out = await groupWorksByTopic({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-19" }, { fetchFn } as never)
    expect(out).toEqual([{ key: "https://openalex.org/T2", label: "Real Topic", count: 3 }])
  })

  it("returns [] when the response has no group_by array", async () => {
    const fetchFn = fetchReturning({})
    const out = await groupWorksByTopic({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-19" }, { fetchFn } as never)
    expect(out).toEqual([])
  })
})

describe("groupWorksByTopicField", () => {
  it("requests group_by=primary_topic.field.id", async () => {
    const fetchFn = fetchReturning({
      group_by: [{ key: "https://openalex.org/fields/28", key_display_name: "Neuroscience", count: 88 }],
    })
    const out = await groupWorksByTopicField({ query: "eeg", fromDate: "2026-07-06", toDate: "2026-07-19" }, { fetchFn } as never)
    expect(String(fetchFn.mock.calls[0][0])).toContain("group_by=primary_topic.field.id")
    expect(out).toEqual([{ key: "https://openalex.org/fields/28", label: "Neuroscience", count: 88 }])
  })
})
```

**Adapt the dependency-injection shape to whatever `groupWorksByPublicationDate` already uses** (it takes an opts object with the same mailto/apiKey and an injectable fetch — copy that exact convention instead of the `as never` placeholder above, and drop the cast).

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/lib/papers/__tests__/openalex-group.test.ts` → FAIL (exports not found).
- [ ] **Step 3: Implement.** Factor the shared body-parsing/mapping out of `groupWorksByPublicationDate` if that keeps things DRY; do NOT change `groupWorksByPublicationDate`'s exported behavior (v1.1's weekly-volume path depends on it and its tests must stay green untouched).
- [ ] **Step 4: Run the new tests, then the full suite** `npx vitest run` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(openalex): group works by topic and topic field`

### Task 2: Anchor-discipline derivation

**Files:**
- Create: `src/lib/trending/anchors.ts`
- Test: `src/lib/trending/__tests__/anchors.test.ts`

**Interfaces:**
- Consumes: `GroupEntry`/`TopicGroupFn` (Task 1), `TrackedField` (`src/lib/trending/fields.ts`, `{slug, label}`).
- Produces:

```ts
export interface AnchorDiscipline { id: string; label: string }
export const MAX_ANCHORS = 3
export async function deriveAnchorDisciplines(
  labels: string[],
  fieldGroupFn: TopicGroupFn,
  window: { fromDate: string; toDate: string },
): Promise<AnchorDiscipline[]>
```

Behavior: for each label, one `fieldGroupFn` call; take the **highest-count** field entry for that label (the modal field). Aggregate across labels by summing counts per field id; sort by summed count desc, tie-break by label asc; return at most `MAX_ANCHORS`. A label whose call throws or returns `[]` contributes nothing and never fails the whole derivation. All labels failing returns `[]` (the caller's cue to fall back).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest"
import { deriveAnchorDisciplines, MAX_ANCHORS } from "../anchors"

const WINDOW = { fromDate: "2026-07-06", toDate: "2026-07-19" }

it("rolls a narrow label up to its modal field", async () => {
  const fieldGroupFn = vi.fn(async () => [
    { key: "f/neuro", label: "Neuroscience", count: 120 },
    { key: "f/cs", label: "Computer Science", count: 30 },
  ])
  expect(await deriveAnchorDisciplines(["auditory attention decoding (EEG)"], fieldGroupFn, WINDOW)).toEqual([
    { id: "f/neuro", label: "Neuroscience" },
  ])
})

it("dedupes across labels and orders by summed count", async () => {
  const fieldGroupFn = vi.fn(async (q: { query: string }) =>
    q.query === "a"
      ? [{ key: "f/cs", label: "Computer Science", count: 10 }]
      : q.query === "b"
        ? [{ key: "f/neuro", label: "Neuroscience", count: 100 }]
        : [{ key: "f/cs", label: "Computer Science", count: 50 }],
  )
  const out = await deriveAnchorDisciplines(["a", "b", "c"], fieldGroupFn, WINDOW)
  expect(out).toEqual([
    { id: "f/neuro", label: "Neuroscience" },    // 100
    { id: "f/cs", label: "Computer Science" },   // 10 + 50 = 60
  ])
})

it("caps at MAX_ANCHORS", async () => {
  let n = 0
  const fieldGroupFn = vi.fn(async () => {
    n += 1
    return [{ key: `f/${n}`, label: `Field ${n}`, count: 100 - n }]
  })
  const out = await deriveAnchorDisciplines(["a", "b", "c", "d", "e"], fieldGroupFn, WINDOW)
  expect(out).toHaveLength(MAX_ANCHORS)
})

it("ignores a label whose lookup throws and keeps the rest", async () => {
  const fieldGroupFn = vi.fn(async (q: { query: string }) => {
    if (q.query === "bad") throw new Error("network")
    return [{ key: "f/neuro", label: "Neuroscience", count: 5 }]
  })
  expect(await deriveAnchorDisciplines(["bad", "good"], fieldGroupFn, WINDOW)).toEqual([
    { id: "f/neuro", label: "Neuroscience" },
  ])
})

it("returns [] when every lookup fails", async () => {
  const fieldGroupFn = vi.fn(async () => {
    throw new Error("down")
  })
  expect(await deriveAnchorDisciplines(["a", "b"], fieldGroupFn, WINDOW)).toEqual([])
})

it("returns [] for no labels without calling out", async () => {
  const fieldGroupFn = vi.fn(async () => [])
  expect(await deriveAnchorDisciplines([], fieldGroupFn, WINDOW)).toEqual([])
  expect(fieldGroupFn).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** (`Promise.all` over labels, per-label try/catch, aggregate into a `Map<string, {label, count}>`).
- [ ] **Step 4: Run the new tests + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(trending): derive anchor disciplines from interest labels`

### Task 3: Trending settings gain anchors + override flag

**Files:**
- Modify: `src/lib/trending/settings.ts`
- Modify: `src/app/api/settings/route.ts` (only if it re-validates the trending sub-object separately — check first; it routes through `normalizeTrendingSettings`, so it may need no edit)
- Test: extend `src/lib/trending/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: `AnchorDiscipline` (Task 2).
- Produces: `TrendingSettings` extended to

```ts
export interface TrendingSettings {
  fields: TrackedField[]          // unchanged — the narrow interest labels (now the LENS)
  cadence: Cadence                // unchanged
  anchors: AnchorDiscipline[]     // derived or user-set; [] = not yet derived
  anchorsOverridden: boolean      // true = user set them by hand; derivation must not overwrite
}
export const DEFAULT_TRENDING_SETTINGS: TrendingSettings = { fields: [], cadence: "weekly", anchors: [], anchorsOverridden: false }
```

`normalizeTrendingSettings` tolerates a missing/invalid `anchors` (→ `[]`) and a missing `anchorsOverridden` (→ `false`), validates each anchor as `{id: non-empty string, label: non-empty string}`, drops invalid entries, and caps the array at `MAX_ANCHORS`. Saving still never clobbers sibling settings keys.

- [ ] **Step 1: Write the failing tests** — normalize: absent anchors → `[]` and `anchorsOverridden: false`; a valid pair survives; an entry missing `label` is dropped; more than `MAX_ANCHORS` is truncated; a non-array `anchors` → `[]`; an existing on-disk settings file with only `{fields, cadence}` loads without throwing and gains the defaults.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Read `normalizeTrendingSettings`'s existing `isTrackedField` guard and mirror its style for `isAnchor`.
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit`.** Confirm `/api/settings` round-trips the new keys (the browser-purity gate still bans `loadTrendingSettings`/`saveTrendingSettings` in client code — do not import them from components).
- [ ] **Step 5: Commit** — `feat(trending): persist anchor disciplines in settings`

### Task 4: Window math + growth ranking (the heart)

**Files:**
- Create: `src/lib/trending/topics.ts`
- Test: `src/lib/trending/__tests__/topics.test.ts`

**Interfaces:**
- Consumes: `GroupEntry` (Task 1), `isoWeekStart` (`src/lib/trending/weeks.ts`, returns the UTC Monday of a date as `YYYY-MM-DD`).
- Produces:

```ts
export interface DateWindow { fromDate: string; toDate: string }   // inclusive ISO dates
export const WINDOW_WEEKS = 2
export const MIN_RECENT_COUNT = 5
export const MAX_LEADERBOARD_TOPICS = 10

/** Recent = the last WINDOW_WEEKS complete ISO weeks; prior = the WINDOW_WEEKS before those.
 *  The in-progress week (the one containing `now`) is excluded from both. */
export function completeWindows(now: Date): { recent: DateWindow; prior: DateWindow }

export interface RankedTopic {
  key: string
  label: string
  discipline: string      // AnchorDiscipline.label
  recentCount: number
  priorCount: number
  growth: number | null   // null when priorCount === 0 → "new"
}

export function rankHeatingTopics(
  perDiscipline: Array<{ discipline: string; recent: GroupEntry[]; prior: GroupEntry[] }>,
): RankedTopic[]
```

`rankHeatingTopics`: join recent↔prior by topic `key` per discipline; drop topics with `recentCount < MIN_RECENT_COUNT`; compute growth; merge all disciplines into one list; sort by growth **desc treating `null` as the largest value** (a genuinely new topic that already clears the volume floor is the most interesting), tie-break by `recentCount` desc, then `label` asc; return at most `MAX_LEADERBOARD_TOPICS`. A topic present in one discipline only appears once; if the same topic key appears under two disciplines, keep the one with the higher `recentCount`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"
import { completeWindows, rankHeatingTopics, MIN_RECENT_COUNT, MAX_LEADERBOARD_TOPICS } from "../topics"

describe("completeWindows", () => {
  it("excludes the in-progress week and returns two 14-day windows", () => {
    // 2026-07-24 is a Friday; its ISO week starts Monday 2026-07-20.
    const { recent, prior } = completeWindows(new Date("2026-07-24T12:00:00Z"))
    expect(recent).toEqual({ fromDate: "2026-07-06", toDate: "2026-07-19" })
    expect(prior).toEqual({ fromDate: "2026-06-22", toDate: "2026-07-05" })
  })

  it("is stable anywhere inside the same in-progress week", () => {
    const a = completeWindows(new Date("2026-07-20T00:00:00Z")) // Monday
    const b = completeWindows(new Date("2026-07-26T23:59:59Z")) // Sunday
    expect(a).toEqual(b)
  })
})

describe("rankHeatingTopics", () => {
  const d = (discipline: string, recent: Array<[string, number]>, prior: Array<[string, number]>) => ({
    discipline,
    recent: recent.map(([k, count]) => ({ key: k, label: `L:${k}`, count })),
    prior: prior.map(([k, count]) => ({ key: k, label: `L:${k}`, count })),
  })

  it("computes growth and sorts fastest first", () => {
    const out = rankHeatingTopics([d("Neuro", [["a", 20], ["b", 12]], [["a", 10], ["b", 10]])])
    expect(out.map((t) => [t.key, t.growth])).toEqual([
      ["a", 1],
      ["b", 0.2],
    ])
  })

  it("drops topics under the volume floor", () => {
    const out = rankHeatingTopics([d("Neuro", [["small", MIN_RECENT_COUNT - 1], ["big", MIN_RECENT_COUNT]], [["small", 1], ["big", 1]])])
    expect(out.map((t) => t.key)).toEqual(["big"])
  })

  it("reports growth null for a topic with no prior activity and ranks it first", () => {
    const out = rankHeatingTopics([d("Neuro", [["new", 9], ["grown", 20]], [["grown", 10]])])
    expect(out[0]).toMatchObject({ key: "new", growth: null, priorCount: 0 })
    expect(out[1]).toMatchObject({ key: "grown", growth: 1 })
  })

  it("merges disciplines into one board and tags each row's discipline", () => {
    const out = rankHeatingTopics([
      d("Neuro", [["n", 30]], [["n", 10]]),
      d("CS", [["c", 12]], [["c", 10]]),
    ])
    expect(out.map((t) => [t.key, t.discipline])).toEqual([
      ["n", "Neuro"],
      ["c", "CS"],
    ])
  })

  it("keeps the higher-count side when one topic appears under two disciplines", () => {
    const out = rankHeatingTopics([
      d("Neuro", [["shared", 8]], [["shared", 4]]),
      d("CS", [["shared", 30]], [["shared", 10]]),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: "shared", discipline: "CS", recentCount: 30 })
  })

  it("caps the board at MAX_LEADERBOARD_TOPICS", () => {
    const recent = Array.from({ length: 20 }, (_, i) => [`t${i}`, 10 + i] as [string, number])
    const prior = Array.from({ length: 20 }, (_, i) => [`t${i}`, 5] as [string, number])
    expect(rankHeatingTopics([d("Neuro", recent, prior)])).toHaveLength(MAX_LEADERBOARD_TOPICS)
  })

  it("returns [] for no input", () => {
    expect(rankHeatingTopics([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Compute windows from `isoWeekStart(now)`: the in-progress week's Monday is the exclusive upper bound, so `recent.toDate` is the day before it and each window spans `WINDOW_WEEKS * 7` days. Do all date math in UTC.
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(trending): complete-window growth ranking for heating topics`

### Task 5: The lens — relevance and knowledge-base links

**Files:**
- Create: `src/lib/trending/lens.ts`
- Test: `src/lib/trending/__tests__/lens.test.ts`

**Interfaces:**
- Consumes: `Bundle` (`src/lib/vault/bundle.ts`), `PaperRecord` (`src/lib/papers/types.ts`), `findPaperPage(bundle, slug)` (`src/lib/papers/page-state.ts`), `paperSlug(paper)` (`src/lib/wiki/authoring.ts`).
- Produces:

```ts
export interface TopicLensResult {
  relevant: boolean
  /** Wiki page ids for those representative papers that already exist in the vault. */
  wikiPageIds: string[]
}
export function topicLens(
  topic: { label: string; papers: PaperRecord[] },
  interestLabels: string[],
  bundle: Bundle,
): TopicLensResult
```

`relevant` is true when the topic label shares a significant term with any interest label **or** with any tag on any wiki page. Matching is deterministic: lowercase, split on non-alphanumerics, drop tokens shorter than 4 characters and a small stopword set (`with`, `from`, `using`, `based`, `data`, `model`, `models`, `analysis`, `study`), then require at least one shared token. `wikiPageIds` is built by resolving each representative paper through `findPaperPage(bundle, paperSlug(paper))` and collecting the ids that resolve (deduped, order preserved). No counts are produced here — the UI renders links only.

- [ ] **Step 1: Write the failing tests** covering: a shared significant term makes it relevant; a match on only a stopword or a ≤3-char token does not; a tag on a wiki page (not an interest label) also makes it relevant; case and punctuation are ignored; representative papers that exist in the vault yield their page ids in order without duplicates; papers absent from the vault yield `[]`; empty interests + empty bundle yield `{relevant: false, wikiPageIds: []}`. Build the bundle with the in-memory pages-Map helper used in `src/lib/viz/__tests__/graph.test.ts` or `src/lib/wiki/__tests__/dashboard.test.ts` — read one of those first and follow its fixture style.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** as a pure function; export the tokenizer privately (not part of the public API) unless a test needs it directly.
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(trending): deterministic relevance lens and wiki-page links`

### Task 6: Re-scope the trending skill to topic briefs

**Files:**
- Modify: `src/lib/skills/trending.ts`
- Test: rewrite `src/lib/skills/__tests__/trending.test.ts` (follow the existing file's structure)

**Interfaces:**
- Produces:

```ts
export const TopicBriefsSchema = z.object({
  topics: z.array(z.object({ key: z.string().min(1), why: z.string().min(1) })).min(1),
  crossDisciplineNote: z.string().min(1),
})
export type TopicBriefs = z.infer<typeof TopicBriefsSchema>

export interface TopicBriefsInput {
  discipline: string
  topics: Array<{ key: string; label: string; paperTitles: string[] }>
}
export const trendingSkill: SkillDefinition<TopicBriefsInput, TopicBriefs>
```

The input carries **no counts, percentages, or dates** — only labels and representative paper titles — so the model has no figures available to echo. The prompt instructs: one short paragraph per topic on *why researchers are converging on it*, keyed by the topic's `key` verbatim; plus one `crossDisciplineNote` on connections between the listed topics. Persona-free (no companion voice). Keep the existing tier (`strong`) and `maxTokens: 4096`, and keep the module a pure LLM unit with no storage access (the orchestrator owns storage).

- [ ] **Step 1: Write the failing tests** — the schema rejects an empty `topics` array, an empty `why`, and a missing `crossDisciplineNote`; the built prompt contains every topic label and every representative title; the built prompt contains **no digits** from counts (assert the input carries none and that `buildPrompt`'s output has no `%` character); `key`s round-trip verbatim. Mirror however the existing test file invokes the skill's prompt builder.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**, replacing `TrendingSurveySchema`/`TrendingSurvey` and their prompt. Grep for every importer of the old names and update them in this commit so the tree compiles (`src/lib/trending/dashboard.ts` and `src/components/trending/FieldPanelView.tsx` are the known ones; the latter is retired in Task 9 — if it still imports the old type, leave a compiling shim or delete it now and adjust its test, but do not leave the build broken).
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(trending): topic-brief skill replaces the per-field survey`

### Task 7: Board orchestrator + cache version guard

**Files:**
- Modify: `src/lib/trending/dashboard.ts`
- Modify: `src/app/api/skills/trending/refresh/route.ts`, `src/app/api/skills/trending/auto-refresh/route.ts`
- Test: extend `src/lib/trending/__tests__/dashboard.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6 (`nodeTopicGroupFn`/`nodeTopicFieldGroupFn`, `deriveAnchorDisciplines`, `completeWindows`/`rankHeatingTopics`, `topicLens`, `trendingSkill`), plus the existing `retrieveFieldCandidates`, `fetchWeeklyVolume`, `buildWeekStarts`, `runSkill`, `logEvent`.
- Produces:

```ts
export const TRENDING_BOARD_VERSION = 2

export interface BoardPaper { record: PaperRecord; wikiPageId: string | null }
export interface BoardTopic {
  key: string
  label: string
  discipline: string
  growth: number | null
  recentCount: number
  weekly: VolumePoint[]        // [] when the series call failed — the row just loses its sparkline
  papers: BoardPaper[]
  why: string | null           // LLM; null when the skill failed for this topic's discipline
  relevant: boolean
}
export interface TrendingBoard {
  version: number
  anchors: AnchorDiscipline[]
  overview: { totalRecent: number; topTopicLabel: string | null; topTopicGrowth: number | null; relevantCount: number }
  topics: BoardTopic[]
  breakouts: Array<{ record: PaperRecord; citationCount: number; wikiPageId: string | null }>
  crossDisciplineNote: string | null
  surveyError?: string
  generatedAt: string
}

export async function runTrendingBoard(storage: VaultStorage, opts: RunTrendingBoardOpts): Promise<TrendingBoard>
export async function loadBoard(storage: VaultStorage): Promise<TrendingBoard | null>
export function isStale(board: TrendingBoard, cadence: Cadence, now: Date): boolean
export function anchorsMatchBoard(board: TrendingBoard, anchors: AnchorDiscipline[]): boolean
```

`RunTrendingBoardOpts` keeps the existing injection style (`searchFn`, `settings`, `providerOverride`, `now`, `onProgress`, `countFn`, `groupFn`) and adds `topicGroupFn: TopicGroupFn` and `fieldGroupFn: TopicGroupFn`. Keep the existing per-storage in-flight sharing (`WeakMap`) and the `trending_refresh` event exactly as they are.

Pipeline per refresh: resolve anchors (settings' `anchors` when `anchorsOverridden` or already present; otherwise `deriveAnchorDisciplines` and persist the result) → `completeWindows(now)` → per anchor two `topicGroupFn` calls → `rankHeatingTopics` → per kept topic one `fetchWeeklyVolume` (reusing the existing ladder, `[]` on failure) and one `searchFn` for representative papers → deterministic breakouts from `retrieveFieldCandidates`' movers → one `runSkill(trendingSkill)` per anchor discipline → `topicLens` over the bundle → assemble + persist.

**Degradation, each independent and individually tested:** a topic-group call failing for one discipline drops that discipline's topics but keeps the others; a weekly-series failure yields `weekly: []`; a representative-paper search failure yields `papers: []`; a skill failure sets every affected topic's `why` to `null` and records the real reason in `surveyError` (the run still persists); anchors failing to derive falls back to treating the narrow `fields` labels as anchors so the page still renders.

`loadBoard` returns `null` when the parsed JSON's `version !== TRENDING_BOARD_VERSION` (an old v1 `dashboard.json` is a cold start, never a crash) and when the file is missing or unparseable.

- [ ] **Step 1: Write the failing tests** (MemoryVaultStorage + injected fns): a full happy path produces ranked topics with sparklines, papers, whys, and a persisted file whose `version` is `TRENDING_BOARD_VERSION`; `loadBoard` returns `null` for a file written with `version: 1` and for malformed JSON; a failing `topicGroupFn` for one discipline keeps the other's topics; a failing weekly-series yields `weekly: []` with the row still present; a failing skill yields `why: null` on every topic **plus** a non-empty `surveyError` **and still persists the board**; derivation failure falls back to the narrow labels; the overview figures equal the sums/max of the underlying deterministic data. Read the existing `dashboard.test.ts` first and keep its fixture/injection conventions.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**, then update both routes to pass `topicGroupFn: overrides.topicGroupFn ?? nodeTopicGroupFn()` and `fieldGroupFn: overrides.fieldGroupFn ?? nodeTopicFieldGroupFn()`, mirroring the existing `searchFn`/`countFn`/`groupFn` lines exactly. Keep `maybeAutoRefreshTrending`'s ledger/telemetry mapping intact.
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(trending): academia-now board orchestrator with versioned cache`

### Task 8: Leaderboard components

**Files:**
- Create: `src/components/trending/OverviewStrip.tsx`, `TopicRow.tsx`, `Sparkline.tsx`, `Leaderboard.tsx`, `BreakoutPapers.tsx`
- Test: `src/components/trending/__tests__/leaderboard.test.tsx`

**Interfaces:**
- Consumes: `TrendingBoard`/`BoardTopic`/`BoardPaper` (Task 7), `displayTitle`, `wikiHref`, `paperSlug`, SP1 primitives in `src/components/ui/`.
- Produces:
  - `Sparkline({ points }: { points: VolumePoint[] })` — a token-colored inline SVG polyline; renders `null` when `points.length < 2`. No external chart library.
  - `GrowthBadge` (inside `TopicRow.tsx`, not separately exported) — `+38%` styling for positive, muted for negative, the literal word **"new"** when `growth === null`. Never `∞`, never `NaN`.
  - `TopicRow({ topic, rank, expanded, onToggle })` — one dense row: rank · growth badge · `topic.label` · `<Sparkline>` · discipline chip · a "Relevant to you" marker only when `topic.relevant`. Expanded, it renders `topic.why` (or, when `why` is `null`, an honest one-line note that the written summary is unavailable), and each representative paper as `displayTitle(record.title)` linking to `/paper/${paperSlug(record)}`, plus a wiki link via `wikiHref(wikiPageId)` **only when `wikiPageId` is non-null**. The row's expand control is a real `<button>` with `aria-expanded`.
  - `OverviewStrip({ overview })` — three figures with labels; a `null` `topTopicLabel` renders an em dash, not "null".
  - `Leaderboard({ board, expandedKey, onToggle })` — the ordered list plus an inline empty state when `board.topics` is empty ("No topic cleared the activity threshold this window").
  - `BreakoutPapers({ breakouts })` — a compact list; renders `null` when empty.
- All presentational: props in, no vault or network access.

- [ ] **Step 1: Write the failing component tests** (`renderToStaticMarkup`, mirroring `src/components/wiki/dashboard/__tests__/dashboard-components.test.tsx`): growth badge shows `+100%` for `growth: 1` and `new` for `growth: null`; the relevance marker appears only when `relevant`; a wiki link renders only for a paper with a `wikiPageId` and is absent otherwise; `Sparkline` renders nothing for a 1-point series and a `<polyline>` for a 5-point one; an expanded row with `why: null` shows the unavailable note and no empty paragraph; `OverviewStrip` renders an em dash for a null top topic; empty `topics` renders the threshold empty state; `BreakoutPapers` with `[]` renders nothing.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** with SP1 token classes only (no raw hex, no `bg-white`).
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(trending): leaderboard, sparkline, overview and breakout components`

### Task 9: Rebuild `/trending`

**Files:**
- Modify: `src/app/trending/page.tsx`
- Delete: `src/components/trending/FieldPanelView.tsx`, `MomentumStat.tsx`, `PublicationVolumeChart.tsx` (and any tests that only covered them)
- Modify: `src/lib/trending/client.ts` (rename/return type follows `runTrendingBoard`)
- Test: `src/app/trending/__tests__/trending-page.test.tsx` (new; the `src/app/**/__tests__/**/*.test.tsx` glob is already configured)

**Interfaces:**
- Consumes: Tasks 7–8, `loadTrendingSettingsRemote`, `readUserModel`, `effectiveTrackedFields`, `LlmErrorMessage`, `PageHeader`/`Button`/`LoadingState`.
- Produces: `/trending` rendering `OverviewStrip` → `Leaderboard` → `BreakoutPapers`, with one expanded row at a time held in page state.

Preserve the existing page behaviors exactly: stale-while-revalidate on mount (show the cached board immediately, refresh in the background when stale); a failed refresh never wipes a displayed board (error stays local next to Refresh); the anchors-changed case goes through the loading path rather than showing a board for the wrong anchors (`anchorsMatchBoard` replaces `fieldsMatchDashboard`); the empty state points at settings; per-field progress text becomes per-discipline progress. Header shows anchor-discipline chips that open the settings modal's trending section.

- [ ] **Step 1: Write the failing page tests** — mocking the vault/settings/board layer as the existing app-page tests do: a ready board renders the overview and the leaderboard; the empty state renders when there are no interest labels; a board whose anchors differ from the current settings does not render (loading instead); a `surveyError` on the board surfaces without hiding the ranking.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**, then delete the retired components and grep for stragglers (`grep -rn "FieldPanelView\|MomentumStat\|PublicationVolumeChart" src/`) — the tree must have no references left.
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit` + `npm run build`.**
- [ ] **Step 5: Commit** — `feat(trending): /trending renders the academia-now board`

### Task 10: Anchor editor in settings

**Files:**
- Modify: `src/components/settings/TrendingFieldsCard.tsx`
- Test: extend `src/components/settings/__tests__/` (follow the existing settings-card test file's style)

**Interfaces:**
- Consumes: `AnchorDiscipline`, the extended `TrendingSettings` (Task 3), `loadTrendingSettingsRemote`/`saveTrendingSettingsRemote`.
- Produces: the card now shows two clearly separated groups:
  1. **Anchor disciplines** — the current anchors as removable chips, a note saying they are derived from your interests, and a "Reset to auto" control that clears `anchorsOverridden` and empties `anchors` so the next refresh re-derives. Any hand edit sets `anchorsOverridden: true`.
  2. **Your interests (the lens)** — the existing narrow-label editor, relabeled so it is clear these highlight relevant rows rather than bound the board.

  Plus one honest line about quota: refreshing costs roughly 25–30 OpenAlex credits, which is comfortable with a free API key (1000/day) and about three refreshes a day without one (100/day).

- [ ] **Step 1: Write the failing tests** — anchors render as chips; removing one and saving sends `anchorsOverridden: true`; "Reset to auto" sends `anchors: []` **and** `anchorsOverridden: false`; the interests editor still saves `fields` unchanged; the quota line is present.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** (token classes only; keep using the settings-client wrappers — the browser-purity gate bans the server-side settings functions in client code).
- [ ] **Step 4: Run tests + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(settings): anchor-discipline editor with lens/quota copy`

### Task 11: Final gate

**Files:**
- Modify: `CLAUDE.md`, the SP4 spec status block, this plan's status block
- Test: whole repo

- [ ] **Step 1: Full verification** — `npx vitest run` (all green), `npx tsc --noEmit`, `npx eslint src` (≤ 8 errors/5 warnings — the branch's pre-existing baseline), `npm run build`.
- [ ] **Step 2: Browser manual checklist** (self-driven against the real vault via the preview tools, both themes): the leaderboard renders with real growth numbers and sparklines; expand/collapse shows whys and representative papers; paper links reach `/paper/[key]` and wiki links reach real pages; relevance markers appear on the expected rows; the anchor editor round-trips (edit → refresh → board scope changes → Reset to auto → re-derives); a board with no qualifying topics shows the threshold empty state.
- [ ] **Step 3: Live LLM gate** — run the env-gated trending live test against the real provider (`LIVE_LLM_BASE_URL/LIVE_LLM_MODEL/LIVE_LLM_API_KEY npx vitest run src/lib/trending/__tests__/live-*.test.ts`), updating it for the new board shape: assert real multi-week series, schema-valid topic briefs, and record the actual cost. Report the figure; do not merge on a degraded run.
- [ ] **Step 4: Update docs** — CLAUDE.md status paragraph (SP4 built, the M10 partial-week caveat now retired), the spec's Status line, this plan's status; note any deviations found during the walk.
- [ ] **Step 5: Commit** — `docs: SP4 status — academia-now trending board built`; then whole-branch review per superpowers:requesting-code-review.

---

## Self-Review Notes

- **Spec coverage:** §1 IA → Tasks 8–9; §2 anchors → Tasks 1–3 (+ editor in 10); §3 deterministic ranking → Tasks 1, 4; §4 lens → Task 5; §5 data flow/cost/cache → Task 7 (+ quota copy in 10); §6 degradation → Task 7's per-failure tests and Task 8's null-tolerant rendering; §7 testing → per-task + Task 11; §8 files → matches, with one deliberate refinement below.
- **Deviation from the spec, deliberate:** the spec anticipated needing the OpenAlex topic hierarchy inside `PaperRecord` for the modal-field computation. Using `group_by=primary_topic.field.id` gets the field distribution directly in one credit, so `PaperRecord` and `mapFields` are left untouched. Same behavior, smaller blast radius.
- **Constants live in one place each:** `MIN_RECENT_COUNT`, `MAX_LEADERBOARD_TOPICS`, `WINDOW_WEEKS` in `topics.ts`; `MAX_ANCHORS` in `anchors.ts`; `TRENDING_BOARD_VERSION` in `dashboard.ts`.
- **Type consistency checked** across tasks: `GroupEntry` (T1) → `RankedTopic` (T4) → `BoardTopic` (T7) → component props (T8); `AnchorDiscipline` (T2) → settings (T3) → board + editor (T7, T10); `TopicGroupFn` named identically in T1, T2, and T7.
- **Retired by this plan:** `FieldPanelView`/`MomentumStat`/`PublicationVolumeChart` (Task 9), `TrendingSurveySchema`/`TrendingSurvey` (Task 6), and the v1 `dashboard.json` shape (Task 7's version guard treats it as a cold start).
