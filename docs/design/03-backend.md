# Backend Design (Layer 3)

*Status: approved 2026-07-11; runtime model **superseded 2026-07-14 (M11, "local-runtime pivot")** — implementation-complete on branch `m11-local-runtime`, not yet merged. v1 ships as this same Next.js app run **locally** by the user (`npm run dev` / `next start`) — the local server IS the runtime (vault, harness, keys), not just a public-data relay. The single-Vercel-deployment description below remains accurate for the documented future hosted tier; it is not the v1 shape. See `docs/superpowers/specs/2026-07-14-m11-local-runtime-design.md` and [02-system](02-system.md) for the full picture.*

## Principles

- **Stateless and identity-blind for the free tier.** No accounts required, no cookies for app function, no user research data server-side (server here = SciSpark's own infrastructure — see below for the M11 distinction), no logging of query strings (queries reveal research interests — relay and forget).
- **No SciSpark-hosted LLM endpoint for users.** SciSpark itself never holds or proxies a user's BYOK key. As of the M11 local-runtime pivot (2026-07-14), the browser no longer talks to providers directly, though: BYOK keys and LLM calls are handled by the user's own **local** Next.js server (still not SciSpark's infrastructure) via `/api/settings` (keys, redacted on read) and `/api/skills/*` (orchestrator execution) — see "Local-runtime API surface" below. This keeps zero server-side LLM spend for SciSpark while getting keys out of the webpage entirely. The personalized trending dashboard (M10, reframed 2026-07-14) runs on the user's own key like every other skill, now via the local skills API rather than directly in the browser. (The originally-planned trending cron on SciSpark's own key is a v2 growth-path item; see below.)
- In v1 "the server" is the user's own local Next.js process. It exists for everything the browser cannot or should not own directly: the vault on disk, the agent harness and skills, BYOK keys, and CORS-blocked public APIs (now same-origin local routes, not a separately hosted relay). A future hosted deployment would additionally need shared caching and shared daily content for its own (SciSpark-side) concerns — see the v2 growth path below.

## Local-runtime API surface (M11, 2026-07-14 — what makes the local server the runtime)

These routes run on the user's own local server (`localhost`), never on a hosted deployment in v1:

| Route | Method | Job | Notes |
|---|---|---|---|
| `/api/vault/file` | GET/POST/DELETE | mirrors `VaultStorage` read/write/delete/exists 1:1 for the browser's `RemoteVaultStorage` | `.scispark/settings.json` is explicitly **unreachable** here (403) — keys are managed only via `/api/settings`, guarded against path-traversal/case/trailing-slash bypass |
| `/api/vault/list` | GET | mirrors `VaultStorage.list` | |
| `/api/vault/changeset` | POST | applies/reverts a changeset **server-side** (`applyChangeset`/`revertChangeset`) | atomicity/undo never depends on per-file HTTP writes from the browser |
| `/api/skills/*` | POST | one route per skill surface: feed refresh, digest, ingest (+undo), ask, chat, spark quick/deep/estimate/seed, trending refresh (+auto-refresh), companion utterance, consolidate, lint (+estimate/fix), **search-intent** | each wraps `NodeFsVaultStorage` + server-side settings + a Node `searchFn` and invokes the existing orchestrator **unchanged**; long-running runs (Deep Spark phases, feed funnel, trending per-field) stream progress via SSE, short runs return plain JSON |
| `/api/settings` | GET/PUT | reads/writes `vault/.scispark/settings.json` | GET redacts key material to presence flags only; PUT accepts updates including new keys; the browser never receives stored key values back |

No auth token gates these in v1 (single-user local trust model — the same posture as any local dev tool bound to loopback); a token gate is flagged as post-v1 hardening, needed before Tauri exposes this or anything binds non-loopback.

## API surface (complete)

The public-data proxy below is unchanged in shape, but as of the M11 local-runtime pivot (2026-07-14) it runs on the user's **local** server too — the CORS relay is now same-origin local API routes, not a separately hosted deployment. The table describes the (future) hosted-tier deployment story as originally designed; in v1, "server-held keys" means keys held by the local server process on the user's machine.

| Route | Method | Job | Notes |
|---|---|---|---|
| `/api/search/{arxiv\|openalex\|s2\|pubmed}` | GET | normalized passthrough search: one query schema in (`q`, `limit`, `from`, optional `sort=relevance\|date`), one unified paper schema out | server-held S2/NCBI keys (better rate limits); OpenAlex polite-pool email; shared response cache (public data, cache key includes `sort`) |
| `/api/resolve` | GET | DOI/arXiv/OpenAlex ID → best open-access location | Unpaywall + source fallbacks; heavily cached |
| `/api/fetch` | GET | relay a public PDF/HTML full text | streaming; size-capped; **domain allowlist** (publisher/OA hosts) to prevent SSRF/abuse; IP rate-limited (the only bandwidth-expensive route) |
| `/api/trending/{field}` | GET | **v2 (deferred, 2026-07-14 reframe)** — serve the trending agent's daily output | static JSON + markdown from blob storage; CDN-cached |
| `/api/register` | POST | **v2 (deferred, 2026-07-14 reframe)** — optional marketing account capture (email) | Supabase; the only stateful route; gates nothing |

Unified paper schema (returned by `/api/search`, consumed everywhere client-side): `{id: {doi?, arxiv?, openalex?, s2?}, title, abstract, authors: [{name, openalexId?}], year, date, venue, citationCount, citations?: [ids], references?: [ids], oaUrl?, pdfUrl?, htmlUrl?, fields: []}`.

**Search ranking = extracted intent, not a hardcoded adapter policy (post-M12 followup, 2026-07-15).** Two coupled fixes to `/papers` search. (1) The arXiv adapter (`src/lib/papers/arxiv.ts`) was returning off-topic newest papers for topical multi-word queries because it used a loose `all:<phrase>` match + an unconditional `submittedDate` sort; it now AND-joins the terms (`all:a AND all:b`, precision) for **plain free-text** queries, and passes **structured** queries (arXiv field prefixes like `cat:cs.LG` or boolean `AND/OR/ANDNOT` — which the Feed strategy prompt deliberately emits) through **verbatim** so they aren't mangled. (2) Relevance-vs-recency ranking is decided **one step before the search** by intent extraction, not baked into the adapter: the `sort` field on `ArxivQuery`/`OpenAlexQuery` is an optional override — omitted, each adapter keeps its historical default (arXiv → newest-first, OpenAlex → relevance), so every existing server-side caller (`nodeSearchFn` for feed/spark/trending) is unregressed. The `/papers` box calls the **Search-Intent Skill** (`fast` tier, persona-free — see [04-agent-harness](04-agent-harness.md)) via `POST /api/skills/search-intent` to classify the typed query as relevance- or recency-oriented, then passes the chosen `sort` through `/api/search?sort=`; classification is memoized client-side per query and degrades to `relevance` on any failure (missing key, budget, error) so search never breaks. `handleSearch` recognizes only `relevance`/`date` and passes anything else through as `undefined`, so an unknown `sort` param can never reach an adapter or the outbound URL.

## Trending dashboard (v1, reframed 2026-07-14; reworked as "Academia Right Now", SP4 2026-07-25)

M10 was reframed by Tong from a public/anonymous trending page to a **personalized** dashboard. SP4 then reworked what "personalized" means: the board is **scoped by broad anchor disciplines** (derived once from the user's interest labels via `group_by=primary_topic.field.id`, persisted in `.scispark/settings.json`, editable in Settings — `src/lib/trending/anchors.ts`), and the user's own narrow interest labels became the **relevance lens** that marks a row "relevant to you" (`src/lib/trending/lens.ts`), not the retrieval scope. It needs no new server infrastructure, and every number on it is a real OpenAlex figure (never LLM-emitted), gathered server-side behind `/api/skills/trending/refresh` (M11 local-runtime pivot) by `src/lib/trending/dashboard.ts`:

- **one `group_by=primary_topic.id` request per anchor** over the recent window → the candidate topics and their recent counts (`src/lib/trending/topics.ts`);
- **two unscoped counts per anchor** (recent + prior window) → each discipline's corpus size, the denominators that turn counts into SHARES so OpenAlex's indexing lag cancels;
- **one topic-scoped count per candidate** → its true prior-window count (looked up, never read off a second grouped list, which capped at 200 buckets and scored mid-sized topics as "new");
- ranking is by growth in **share of the discipline corpus**; each row renders **prior→recent bars drawn from those same two shares** — there is no weekly series and no top-movers/venues panel (SP4 dropped both: `group_by=publication_date` is dead upstream, see the quota note below, and a per-week ladder costs one request per week per topic);
- `src/lib/skills/trending.ts` is a persona-free `strong`-tier skill contributing **qualitative topic briefs only** ("why researchers are converging on this"), joined back onto the ranking by key verbatim — on the user's own BYOK key, held server-side.

Failure honesty runs both layers: a failed brief leaves `why: null` plus a `surveyError`, and a failed count/grouping DROPS the affected rows (never a raw-count fallback) with the reason carried as `dataError`, so an emptied leaderboard never reads as "nothing is trending". There is still no scheduler process independent of the app in v1 (the local server only runs while the user has it up), so the v1 "cron" remains a **staleness-triggered refresh**: the dashboard is cached at `.scispark/trending/dashboard.json` with a `generatedAt` timestamp, a cadence (`daily`/`weekly`, default weekly) lives in `.scispark/settings.json`, and the harness refreshes in the background when the cache exceeds the cadence (on `/trending` load or app-open), plus a manual Refresh button. See `docs/superpowers/specs/2026-07-24-sp4-trending-academia-now-design.md` for the current design (and `docs/superpowers/specs/2026-07-14-m10-trending-dashboard-design.md` for the M10 shape it replaced).

## Trending cron — v2 (deferred, 2026-07-14 reframe)

This section describes the originally-planned public/anonymous trending model. It is **not built in v1**; it remains a documented growth path for once a real backend + accounts exist (a server can then legitimately hold a shared, user-independent key). Daily Vercel cron → runs the **Trending Skill** (see [04-agent-harness](04-agent-harness.md); the same harness code the local-runtime server already executes elsewhere per M11) once per major field (~20 fields):

1. Pull the last 24–48h of papers per field from the search APIs + citation-velocity movers.
2. `strong`-tier LLM writes a field trend survey: notable papers (with one-line whys), emerging topics, movement since yesterday.
3. Output written to Vercel Blob as `{field}/{date}.json` + rendered markdown; `/api/trending` serves latest.

Cost envelope: ~20 runs/day on SciSpark's key — bounded, predictable, and the output would be reused by every visitor and every user's Feed Skill.

## Caching & rate limits

- Search/resolve responses: cache aggressively (they're public); respect upstream rate limits with per-API token buckets server-side.
- `/api/fetch`: no caching of full documents beyond short-lived streaming buffers in v1 (copyright caution); rate-limit per IP; size cap (~50 MB).
- Trending (v2 public model): immutable per day, CDN-cached.
- **OpenAlex quota (observed live 2026-07-15; supersedes the old "keyless 100k/day + polite pool" model):** OpenAlex now runs a credit-priced API — keyless ≈ **$0.10/day** (a works *search* costs 10 credits ≈ $0.001; a `group_by` aggregation costs 1 credit), a **free API key** (openalex.org/settings/api, `api_key` query param, `OPENALEX_API_KEY` env) raises it to **$1/day**; allowances reset at midnight UTC and `mailto` no longer buys extra capacity. This is fine for v1 because the runtime is per-user local (M11): every user spends their *own* quota, and a heavy day (weekly trending refresh ≈ a few group_by credits + searches, feed refresh, a Deep Spark scoop) stays well inside even the keyless tier. Cost discipline in code: adapters retry 429/5xx with backoff and time out via `AbortController`, and every OpenAlex miss degrades gracefully rather than blocking a panel. **Correction (verified live 2026-07-25): `group_by=publication_date` is no longer accepted by OpenAlex — it returns HTTP 400 "Invalid query parameters error" in every form, while `group_by=publication_year` and `group_by=primary_topic.id` still work.** v1.1's "one grouped request per field" weekly-volume optimization therefore stopped working at some point and had been silently falling back to per-week counts; SP4 removed the dead path and dropped weekly series altogether (its leaderboard rows compare the prior and recent windows, which costs no extra requests). Grouping by topic and by topic field — SP4's ranking primitives — are unaffected.

## What is deliberately NOT in the backend (v1)

- Auth/session infrastructure (only the optional `/api/register` email capture).
- Any database of user activity, vaults, highlights, or preferences.
- Embedding services, recommendation services, or any per-user compute.
- General web-fetch/search for agents (v1.5+, and only via allowlist when it comes).

## v2.0 growth path (designed-for, not built)

- **Cloud vault sync** (paid): a sync service becomes a third `VaultStorage` implementation; end-to-end encryption should be evaluated so the "we can't see your research" claim survives the cloud tier.
- **Managed LLM** (paid): server LLM proxy becomes a second `LLMProvider` implementation; requires real accounts + metering.
- Accounts upgrade from marketing-capture to auth (Supabase Auth) when either paid feature lands.
