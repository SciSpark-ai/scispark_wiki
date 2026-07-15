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
| `/api/skills/*` | POST | one route per skill surface: feed refresh, digest, ingest (+undo), ask, chat, spark quick/deep/estimate/seed, trending refresh (+auto-refresh), companion utterance, consolidate | each wraps `NodeFsVaultStorage` + server-side settings + a Node `searchFn` and invokes the existing orchestrator **unchanged**; long-running runs (Deep Spark phases, feed funnel, trending per-field) stream progress via SSE, short runs return plain JSON |
| `/api/settings` | GET/PUT | reads/writes `vault/.scispark/settings.json` | GET redacts key material to presence flags only; PUT accepts updates including new keys; the browser never receives stored key values back |

No auth token gates these in v1 (single-user local trust model — the same posture as any local dev tool bound to loopback); a token gate is flagged as post-v1 hardening, needed before Tauri exposes this or anything binds non-loopback.

## API surface (complete)

The public-data proxy below is unchanged in shape, but as of the M11 local-runtime pivot (2026-07-14) it runs on the user's **local** server too — the CORS relay is now same-origin local API routes, not a separately hosted deployment. The table describes the (future) hosted-tier deployment story as originally designed; in v1, "server-held keys" means keys held by the local server process on the user's machine.

| Route | Method | Job | Notes |
|---|---|---|---|
| `/api/search/{arxiv\|openalex\|s2\|pubmed}` | GET | normalized passthrough search: one query schema in, one unified paper schema out | server-held S2/NCBI keys (better rate limits); OpenAlex polite-pool email; shared response cache (public data, cache key = query) |
| `/api/resolve` | GET | DOI/arXiv/OpenAlex ID → best open-access location | Unpaywall + source fallbacks; heavily cached |
| `/api/fetch` | GET | relay a public PDF/HTML full text | streaming; size-capped; **domain allowlist** (publisher/OA hosts) to prevent SSRF/abuse; IP rate-limited (the only bandwidth-expensive route) |
| `/api/trending/{field}` | GET | **v2 (deferred, 2026-07-14 reframe)** — serve the trending agent's daily output | static JSON + markdown from blob storage; CDN-cached |
| `/api/register` | POST | **v2 (deferred, 2026-07-14 reframe)** — optional marketing account capture (email) | Supabase; the only stateful route; gates nothing |

Unified paper schema (returned by `/api/search`, consumed everywhere client-side): `{id: {doi?, arxiv?, openalex?, s2?}, title, abstract, authors: [{name, openalexId?}], year, date, venue, citationCount, citations?: [ids], references?: [ids], oaUrl?, pdfUrl?, htmlUrl?, fields: []}`.

## Trending dashboard (v1, reframed 2026-07-14)

M10 was reframed by Tong from a public/anonymous trending page to a **personalized** dashboard scoped to the user's own fixed research sub-fields (seeded from `interests.md`, editable on `/profile`, capped at `MAX_TRACKED_FIELDS`). It needs no new server infrastructure: `src/lib/trending/retrieve.ts` calls the existing `/api/search/*` routes via the same `SearchFn` used by M5/M9 (invoked server-side behind `/api/skills/trending/refresh` since the M11 local-runtime pivot, 2026-07-14), `src/lib/trending/metrics.ts` computes all quantitative numbers deterministically (never LLM-emitted), and `src/lib/skills/trending.ts` is a persona-free `strong`-tier skill that writes only the qualitative survey (notable-paper whys, emerging topics, momentum narrative) — all on the user's own BYOK key, held server-side. There is still no scheduler process independent of the app in v1 (the local server only runs while the user has it up), so the v1 "cron" remains a **staleness-triggered refresh**: the dashboard is cached at `.scispark/trending/dashboard.json` with a `generatedAt` timestamp, a cadence (`daily`/`weekly`, default weekly) lives in `.scispark/settings.json`, and the harness refreshes in the background when the cache exceeds the cadence (on `/trending` load or app-open), plus a manual Refresh button. See `docs/superpowers/specs/2026-07-14-m10-trending-dashboard-design.md` for the full design.

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

## What is deliberately NOT in the backend (v1)

- Auth/session infrastructure (only the optional `/api/register` email capture).
- Any database of user activity, vaults, highlights, or preferences.
- Embedding services, recommendation services, or any per-user compute.
- General web-fetch/search for agents (v1.5+, and only via allowlist when it comes).

## v2.0 growth path (designed-for, not built)

- **Cloud vault sync** (paid): a sync service becomes a third `VaultStorage` implementation; end-to-end encryption should be evaluated so the "we can't see your research" claim survives the cloud tier.
- **Managed LLM** (paid): server LLM proxy becomes a second `LLMProvider` implementation; requires real accounts + metering.
- Accounts upgrade from marketing-capture to auth (Supabase Auth) when either paid feature lands.
