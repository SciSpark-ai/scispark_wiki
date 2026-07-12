# Backend Design (Layer 3)

*Status: approved 2026-07-11. One deployment: the web app and its API are a single Next.js app on Vercel.*

## Principles

- **Stateless and identity-blind for the free tier.** No accounts required, no cookies for app function, no user research data server-side, no logging of query strings (queries reveal research interests — relay and forget).
- **No server-side LLM endpoint for users.** BYOK traffic goes browser → provider directly. The only server LLM spend is the trending cron on SciSpark's own key — fixed daily cost, user-independent, nothing for abusers to farm.
- The server exists only for what browsers cannot do: CORS-blocked APIs, server-held API keys, shared caching, and shared daily content.

## API surface (complete)

| Route | Method | Job | Notes |
|---|---|---|---|
| `/api/search/{arxiv\|openalex\|s2\|pubmed}` | GET | normalized passthrough search: one query schema in, one unified paper schema out | server-held S2/NCBI keys (better rate limits); OpenAlex polite-pool email; shared response cache (public data, cache key = query) |
| `/api/resolve` | GET | DOI/arXiv/OpenAlex ID → best open-access location | Unpaywall + source fallbacks; heavily cached |
| `/api/fetch` | GET | relay a public PDF/HTML full text | streaming; size-capped; **domain allowlist** (publisher/OA hosts) to prevent SSRF/abuse; IP rate-limited (the only bandwidth-expensive route) |
| `/api/trending/{field}` | GET | serve the trending agent's daily output | static JSON + markdown from blob storage; CDN-cached |
| `/api/register` | POST | optional marketing account capture (email) | Supabase; the only stateful route; gates nothing |

Unified paper schema (returned by `/api/search`, consumed everywhere client-side): `{id: {doi?, arxiv?, openalex?, s2?}, title, abstract, authors: [{name, openalexId?}], year, date, venue, citationCount, citations?: [ids], references?: [ids], oaUrl?, pdfUrl?, htmlUrl?, fields: []}`.

## Trending cron

Daily Vercel cron → runs the **Trending Skill** (see [04-agent-harness](04-agent-harness.md); same harness code as the client, executed server-side) once per major field (~20 fields):

1. Pull the last 24–48h of papers per field from the search APIs + citation-velocity movers.
2. `strong`-tier LLM writes a field trend survey: notable papers (with one-line whys), emerging topics, movement since yesterday.
3. Output written to Vercel Blob as `{field}/{date}.json` + rendered markdown; `/api/trending` serves latest.

Cost envelope: ~20 runs/day on SciSpark's key — bounded, predictable, and the output is reused by every visitor and every user's Feed Skill.

## Caching & rate limits

- Search/resolve responses: cache aggressively (they're public); respect upstream rate limits with per-API token buckets server-side.
- `/api/fetch`: no caching of full documents beyond short-lived streaming buffers in v1 (copyright caution); rate-limit per IP; size cap (~50 MB).
- Trending: immutable per day, CDN-cached.

## What is deliberately NOT in the backend (v1)

- Auth/session infrastructure (only the optional `/api/register` email capture).
- Any database of user activity, vaults, highlights, or preferences.
- Embedding services, recommendation services, or any per-user compute.
- General web-fetch/search for agents (v1.5+, and only via allowlist when it comes).

## v2.0 growth path (designed-for, not built)

- **Cloud vault sync** (paid): a sync service becomes a third `VaultStorage` implementation; end-to-end encryption should be evaluated so the "we can't see your research" claim survives the cloud tier.
- **Managed LLM** (paid): server LLM proxy becomes a second `LLMProvider` implementation; requires real accounts + metering.
- Accounts upgrade from marketing-capture to auth (Supabase Auth) when either paid feature lands.
