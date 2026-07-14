# Backend Design (Layer 3)

*Status: approved 2026-07-11. One deployment: the web app and its API are a single Next.js app on Vercel.*

## Principles

- **Stateless and identity-blind for the free tier.** No accounts required, no cookies for app function, no user research data server-side, no logging of query strings (queries reveal research interests — relay and forget).
- **No server-side LLM endpoint for users.** BYOK traffic goes browser → provider directly. In v1 there is no server-side LLM spend at all — the personalized trending dashboard (M10, reframed 2026-07-14) runs client-side on the user's own key, like every other skill. (The originally-planned trending cron on SciSpark's own key is a v2 growth-path item; see below.)
- The server exists only for what browsers cannot do: CORS-blocked APIs, server-held API keys, shared caching, and shared daily content.

## API surface (complete)

| Route | Method | Job | Notes |
|---|---|---|---|
| `/api/search/{arxiv\|openalex\|s2\|pubmed}` | GET | normalized passthrough search: one query schema in, one unified paper schema out | server-held S2/NCBI keys (better rate limits); OpenAlex polite-pool email; shared response cache (public data, cache key = query) |
| `/api/resolve` | GET | DOI/arXiv/OpenAlex ID → best open-access location | Unpaywall + source fallbacks; heavily cached |
| `/api/fetch` | GET | relay a public PDF/HTML full text | streaming; size-capped; **domain allowlist** (publisher/OA hosts) to prevent SSRF/abuse; IP rate-limited (the only bandwidth-expensive route) |
| `/api/trending/{field}` | GET | **v2 (deferred, 2026-07-14 reframe)** — serve the trending agent's daily output | static JSON + markdown from blob storage; CDN-cached |
| `/api/register` | POST | **v2 (deferred, 2026-07-14 reframe)** — optional marketing account capture (email) | Supabase; the only stateful route; gates nothing |

Unified paper schema (returned by `/api/search`, consumed everywhere client-side): `{id: {doi?, arxiv?, openalex?, s2?}, title, abstract, authors: [{name, openalexId?}], year, date, venue, citationCount, citations?: [ids], references?: [ids], oaUrl?, pdfUrl?, htmlUrl?, fields: []}`.

## Trending dashboard (v1, reframed 2026-07-14)

M10 was reframed by Tong from a public/anonymous trending page to a **personalized** dashboard scoped to the user's own fixed research sub-fields (seeded from `interests.md`, editable on `/profile`, capped at `MAX_TRACKED_FIELDS`). It needs no new server infrastructure: `src/lib/trending/retrieve.ts` calls the existing `/api/search/*` routes (the same client-side `SearchFn` used by M5/M9), `src/lib/trending/metrics.ts` computes all quantitative numbers deterministically (never LLM-emitted), and `src/lib/skills/trending.ts` is a persona-free `strong`-tier skill that writes only the qualitative survey (notable-paper whys, emerging topics, momentum narrative) — all on the user's own BYOK key. Because a browser cannot run a schedule while closed and there is no backend to hold a per-user key, the v1 "cron" is a **staleness-triggered refresh**: the dashboard is cached at `.scispark/trending/dashboard.json` with a `generatedAt` timestamp, a cadence (`daily`/`weekly`, default weekly) lives in `.scispark/settings.json`, and the harness refreshes in the background when the cache exceeds the cadence (on `/trending` load or app-open), plus a manual Refresh button. See `docs/superpowers/specs/2026-07-14-m10-trending-dashboard-design.md` for the full design.

## Trending cron — v2 (deferred, 2026-07-14 reframe)

This section describes the originally-planned public/anonymous trending model. It is **not built in v1**; it remains a documented growth path for once a real backend + accounts exist (a server can then legitimately hold a shared, user-independent key). Daily Vercel cron → runs the **Trending Skill** (see [04-agent-harness](04-agent-harness.md); same harness code as the client, executed server-side) once per major field (~20 fields):

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
