# v1 Build Roadmap (Layer 6 — execution order)

*Each milestone is an independent implementation plan (in `docs/superpowers/plans/`) that ends with working, testable software. Order chosen so every milestone builds on tested foundations and the app is demoable early.*

| # | Milestone | Delivers | Depends on |
|---|---|---|---|
| M1 | **Bootstrap + Vault core** | forked app running in this repo; vault library (frontmatter, bundle, changesets, index/log, OPFS+memory storage, zip export) fully tested | — |
| M2 | **LLM harness** | LLMProvider (Anthropic/OpenAI/Google/OpenRouter), tier mapping, structured output, metering + daily budget, skill-runner primitives | M1 |
| M3 | **Proxy backend** | `/api/search/*` (4 sources, unified schema), `/api/resolve`, `/api/fetch`; caching + rate limits | — (parallel with M2) |
| M4 | **Ingest + wiki UI** | Digest Skill, Ingest Skill end-to-end (paper → wiki changeset), wiki browse/edit (Milkdown), review queue, undo | M1–M3 |
| M5 | **Feed + user model** | events log, Memory-Consolidation Skill, Feed Skill (agentic funnel), generalized onboarding → personalized home | M1–M4 |
| M6 | **Reader** | pdf.js + HTML reader, persistent highlights, select-to-ask (Reading-Companion Skill) | M1–M4 |
| M7 | **Companion** | persona layer wrapping all chat surfaces, proactivity engine, mascot UI | M2, M5 |
| M8 | **Visualization dashboard** | graph (Sigma), timeline, citation flow, author network (D3) | M4 |
| M9 | **Spark** | Quick Spark + Deep Spark (ResearchStudio adaptation), idea pages/gallery | M2–M4 |
| M10 | **Trending dashboard** | personalized fixed-field trends (deterministic metrics + charts + LLM survey), staleness-refreshed, client-side/BYOK | M2, M3 |
| M11 | **Lint + hardening** | Lint Skill, FSA folder storage polish, export/import round-trip QA, budget UX polish | all |

Clinical mock content from the fork is *kept as placeholder* through M1–M4 and replaced organically when real data arrives (M5); copy/branding generalization happens in M1 only where user-visible.

**M10 reframe (Tong, 2026-07-14):** the original M10 concept — a public/anonymous trending page produced by a server-side Vercel cron + Vercel Blob, with `/api/register`+Supabase marketing capture — is dropped for v1 and moved to a documented **v2 path** (see `docs/design/03-backend.md` and `docs/superpowers/specs/2026-07-14-m10-trending-dashboard-design.md`). M10 as built is a personalized, fixed-field "what's big in your field" dashboard, local-first/BYOK, with a staleness-triggered refresh standing in for the v1 "cron."
