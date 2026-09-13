# Ponytail audit cleanup — spec

Date: 2026-09-12
Status: approved scope for the cleanup plan (`docs/superpowers/plans/2026-09-12-ponytail-audit-cleanup.md`).
Source: repo-wide `/ponytail-audit` run on `main` at `3354ce5` (412 source files, ~45k lines; 2575 tests green, lint 0 errors / 1 warning).

## Goal

Remove dead code, collapse copy-pasted helpers, and drop dependencies the platform already covers — with **zero behavior change** for any user-reachable surface. Every cut below was verified by import/caller search, not name matching.

## In scope (executed by the plan)

| # | Cut | Verified evidence |
|---|---|---|
| 1 | Seven fork-era components nothing imports: `ShareButton`, `ConfirmDialog`, `StarsRating`, `SkeletonCard`, `shared/EmptyState`, `ProgressiveText`, `PaperResultItem` (+3 tests) | zero non-test importers; `ui/EmptyState`, `DeleteConfirmCard`, `ResearchSearchResultItem` are the live equivalents |
| 2 | `LegacyPrototypeWarning` + `lib/projects/legacy-data.ts` (+test) | warns about localStorage keys from the fork-mock prototype that no real user ever ran |
| 3 | `RightPanel` + the ui-store fields nothing reads (`showRightPanel`/`rightPanelContent`/`setRightPanel`/`setShowRightPanel`/`toggleRightPanel`, `sourcesPanelOpen`/`setSourcesPanelOpen`/`toggleSourcesPanel`, `activeNav`/`setActiveNav`, `toggleSidebar`, `setDesktopSidebarOpen`) | `setRightPanel` has zero callers → content is always `null` → the panel can never open |
| 4 | The standalone **search-intent** feature (`lib/skills/search-intent.ts`, its route, `search-intent-client.ts`, 4 tests incl. the live gate) and `research-search-client.ts` (+test), and the `/library` redirect page | `classifySearchIntentRemote` has no caller (`/papers` was slimmed in SP2); the research-search planner already emits `sort: relevance\|date` (`research-search.ts:35,55`), so Tong's "extract intent before search" directive is still honored; nothing links `/library` |
| 5 | `feedRankSkill`/`feedRerankSkill` + `RankSchema`/`RerankSchema` section of `feed.ts` | `runFeed` replaced them with `recommendationAssessmentSkill`; only the stage names survive as wire-compat |
| 6 | Small dead exports: `learnTopicAdjustments`, `feedbackDecay`, `cardsByIds`, `updateHighlight`, `autoRefreshTrending`, `createUserProfileRemote`, `MAX_ANCHOR_LABEL_LENGTH`, `*_CATALOG_DATE` | zero production callers; their only tests test them in isolation |
| 7 | `get-vault.ts` Memory/`openVault` fallback + retry memo (+test) | every caller is a `"use client"` page; the fallback is exercised only by its own test |
| 8 | 12 hand-rolled `jsonResponse(status, body)` helpers | 45 other sites already use `Response.json(body, { status })` |
| 9 | Byte-identical private helpers: `readErrorMessage` ×7, `readJsonFile` ×3, `readFailureReason` ×2, `tokenize` ×3, `asStringArray` ×3, `clampLimit` ×4 (identical bounds), `safeParse` ×3, `truncateAtWhitespace` ×2, `utcDateString`/`today` ×4, `slugOf` ×2 | md5 of the bodies matches |
| 10 | `fetchWithTimeout` + manual `AbortController` deadline | `AbortSignal.timeout` / `AbortSignal.any` already used at 7 sites; Node 24 runtime |
| 11 | `NavStore` interface | one real implementation (`sessionStorage`) → `Pick<Storage, "getItem" \| "setItem">` |
| 12 | `framer-motion` (5.5 MB) | five opacity/translate/scale enter–exit fades → CSS transitions + Tailwind 4.2 `starting:` variant (`@starting-style`) |
| 13 | `@anthropic-ai/sdk` (9.9 MB) | one `POST /v1/messages` + SSE + 5 error classes → raw `fetch` + the repo's own `readSseData`, exactly like `openai-compat.ts`/`google.ts` |
| 14 | `d3-scale` + `d3-shape` (+ `@types`) | two `scaleLinear` calls (arithmetic + a 1/2/5 tick step) and one `linkHorizontal` (one path string) |
| 15 | 2.1 MB of tool output tracked in git (`.understand-anything/`) | generated artifacts; keep locally, stop tracking |

## Decisions (defaults chosen; say the word to flip any)

- **D1 Scheduler heartbeat (`SCISPARK_SCHEDULER=on`, 277 lines):** KEEP and document the flag in `.env.example`. It is the deliberate post-M11 "cron" (heartbeat.ts rationale block); the audit finding was that the flag is undocumented, not that the design is wrong. Alternative: delete `src/lib/scheduler/`, the `startHeartbeat` lines in `src/instrumentation.ts`, and `src/lib/scheduler/__tests__/`.
- **D2 Review reservation ledger + `scoped-pricing.ts`:** KEEP. The in-flight Codex/Claude engines proposal (`docs/superpowers/plans/2026-09-08-codex-claude-engines.md`) names `review/budget.ts` as a verified integration point; consolidating it into `runSkill` is a design change, not a cleanup.
- **D3 Two force-layout engines (`d3-force` vs `graphology-layout-forceatlas2`):** KEEP both. FA2 has no collision force; swapping the author network onto it would change layout quality. Revisit only if bundle size matters.
- **D4 `importVaultZip` / `/debug/vault`:** KEEP. `importVaultZip` is the round-trip verifier used by `e2e/developer-preview.spec.ts` and `recommendation-feedback-api.test.ts`; `/debug/vault` is the only export surface.
- **D5 `scripts/probe-review-engines.py`, `scripts/preview-chat-history.mjs`:** KEEP. Both are 5 days old and belong to the in-flight engines work.
- **`RegExp.escape`:** skipped — TypeScript 5 has no lib typing for it, so the `declare` costs more lines than the 3-line helper.
- **`requestJson` ×2:** skipped — the two copies throw different error classes (`HistoryApiError` with `divergedPaths` vs `ProjectApiError`); a generic would couple them for ~10 lines.

## Global constraints

- No user-visible behavior change except: bubble/drawer exit fades become instant (enter fades stay), and the Anthropic provider gets the same 120 s request timeout Google already has.
- Keep every repo guard green: browser-purity (`src/lib/__tests__/browser-purity.test.ts`), no-raw-hex/`bg-white` source guard, source-hygiene (no control bytes), `npm run lint` at 0 errors, `npx tsc --noEmit`, `npm run build`.
- Node 24 runtime (`AbortSignal.timeout`, `AbortSignal.any`, `Response.json` are all native); Tailwind 4.2.2 (`starting:` variant available); React 19.2 (`inert` prop supported).
- Test baseline before the plan: 2575 passed / 17 skipped. Every task ends with the full suite green; the count goes DOWN only by the deleted test cases named in that task.

## Expected net

≈ −1,900 source+test lines, −4 runtime deps (`framer-motion`, `@anthropic-ai/sdk`, `d3-scale`, `d3-shape`) and −2 dev deps (`@types/d3-scale`, `@types/d3-shape`), ~9 transitive `d3-*` packages, −2.1 MB tracked JSON.
