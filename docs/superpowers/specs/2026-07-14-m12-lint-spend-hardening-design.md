# M12 — Lint, Spend Panel, Hardening (Design)

**Status:** approved by Tong 2026-07-14. Final v1 milestone. Scope chosen: Lint Skill + Spend panel + Hardening bundle + export round-trip tests + the 04/05 docs rewrite. Zip export/import UI and the dead-code cleanup (mock-feed subtree, `browserSearchFn`) are deferred.

## Context

M11 moved the runtime to a local Next.js server: vault is plain files on disk (`NodeFsVaultStorage` via `getServerVault()`), orchestrators run server-side behind `/api/skills/*`, the browser is UI-only over `/api/vault/*` + `/api/settings` (redacted keys) + a browser-purity gate. M12's new server work follows that pattern: new skills/aggregations run server-side; the browser fetches.

## 1. Lint Skill

The last agent skill: scan the wiki bundle for problems and propose undoable fixes, feeding the existing review inbox.

**Split free / LLM (Tong):**
- **Deterministic pass** — pure functions over the loaded `Bundle` (`src/lib/vault/bundle.ts`), no LLM, instant, free:
  - `orphan` — a page with no inbound wikilinks and not a reserved/index file (`index.md`, `log.md`, `purpose.md`, `schema.md`) and not a `paper`/`author` root (those are legitimately leaf-linked).
  - `broken-link` — a wikilink whose target slug resolves to no page in the bundle.
  - `bad-frontmatter` — missing/invalid required frontmatter per the schema contract (`type`, `title`, `created`, `updated`, `tags[]`, `related[]` bare slugs, `sources[]` where the type requires it).
  - `index-drift` — `index.md`/`log.md` (app-maintained, deterministic projections) disagree with a fresh recompute from the current pages.
- **LLM judgment pass** — separate, manual, cost shown up front; persona-free; fenced input:
  - `contradiction` — two related pages assert conflicting claims.
  - `stale-claim` — a page's claim is outdated relative to a newer related page.
  - Two-stage to bound cost: a `fast`-tier screen proposes candidate page pairs (from `related[]` + shared-source adjacency), then `strong` judges only the flagged pairs.

**Skill boundary (blessed pattern):** the deterministic checks are pure library functions (`src/lib/lint/*.ts`); the LLM stage is a pure skill (`src/lib/skills/lint.ts`, `strong`/`fast`); an orchestrator (`src/lib/lint/run.ts`) owns bundle loading + candidate assembly + turning findings into review items. `runLintDeterministic(bundle)` and `runLintLlm(storage, opts)` are separate entry points.

**Output → review inbox:** each finding becomes a `ReviewItem` (`src/lib/wiki/review-queue.ts`) with a new kind added to the union: `"lint-finding"` (carrying a `lintKind` discriminator for the six subtypes above), written to `.scispark/review/{id}.json` exactly like ingest's items. Mechanical findings (broken-link, bad-frontmatter, index-drift) carry a **fix changeset** the inbox applies with one click (remove/repair the link, add the missing field, rewrite index) — undoable like every changeset. Judgment findings (contradiction, stale-claim, orphan) are advisory (no auto-fix; the user resolves in the wiki or via chat).

**Routes:** `POST /api/skills/lint` with `{ mode: "deterministic" | "llm" }` — deterministic returns findings as JSON immediately (writes review items server-side); llm streams NDJSON progress (pair-by-pair) then the findings. `POST /api/skills/lint/estimate` → `{ costUsd }` for the deep-lint confirm. Client helpers in `src/lib/lint/client.ts`.

**UI:** a "Lint vault" control (on `/wiki` or `/wiki/inbox`) runs the deterministic pass instantly and shows a count + writes review items; a secondary "Run deep lint (~$X — proceed?)" runs the LLM pass behind a cost-confirm (same estimate→confirm idiom as Deep Spark). Findings appear in the existing inbox; the inbox renders the new `lint-finding` kind with its fix affordance.

**Tool registry:** Lint gets `vault.read/search/list` + `vault.propose_changeset` + `user.flag` per the design-doc allowlist. No `papers.*`.

## 2. Spend panel

Make the existing `.scispark/usage/*.jsonl` metering ledger visible and the budget editable.

**Server:** `GET /api/usage` aggregates the ledger via `getServerVault()`: reads `.scispark/usage/YYYY-MM-DD.jsonl` for the last 7 UTC days, returns `{ today: { totalUsd, byskill: Record<string, number> }, days: Array<{ date, totalUsd }>, budgetUsd }`. Pure aggregation over the `UsageRecord` shape (`src/lib/llm/metering.ts`: `{ ts, skill, model, usage, costUsd }`); `costUsd: null` records (unpriced models) count as 0 and are surfaced as an "unpriced" note. No keys in the ledger — no redaction needed (verified: `UsageRecord` has no key field).

**Aggregation library:** `src/lib/llm/usage-summary.ts` — `summarizeUsage(records: UsageRecord[], now: Date): UsageSummary` (pure, thoroughly unit-tested: day bucketing by UTC date, per-skill sums, today vs 7-day, null-cost handling).

**Client:** a spend section on `/profile` (or `/debug/llm` — wherever the budget currently lives): today's spend vs `dailyBudgetUsd` as a progress bar (over-budget state highlighted), a 7-day daily bar chart (pure geometry helper + SVG, reusing the M10 `chart-geometry` pattern), a per-skill breakdown table, and a budget editor that PUTs `dailyBudgetUsd` through the existing `/api/settings`. The harness's over-budget degradation message links here.

## 3. Hardening bundle

**3a. One shared settings write-lock.** Today three modules write the single `.scispark/settings.json`: `llm/settings.ts` (`saveSettings` — **no queue**, racy), `companion/settings.ts` and `trending/settings.ts` (each its own `WeakMap` queue — serialized only within themselves). Concurrent saves across modules can lost-update each other's top-level key. Fix: one shared helper `src/lib/vault/settings-write.ts` — `withSettingsWrite(storage, mutate: (file) => file): Promise<void>` keyed by a single module-level `WeakMap<VaultStorage, Promise<void>>`, doing the read-modify-write of the whole `.scispark/settings.json` under one per-storage serialized chain. All three `saveX` functions and the `/api/settings` PUT route through it. Behavior unchanged for callers; the cross-module race is closed. (The metering `usageWriteQueues` is separate and correct — it serializes per-day append files, not the shared settings file — left as is.)

**3b. Fetch timeouts on searches.** arXiv, OpenAlex, and any adapter the search paths use currently `await fetch(url)` with no timeout — a hung connection stalls a scoop/trending/feed phase indefinitely (only the live-gate test timeout ever catches it). Fix: a small `fetchWithTimeout(fetchFn, url, ms)` helper (`src/lib/papers/fetch-timeout.ts`, default ~15s via `AbortController`) used by the adapters; a timeout throws (caught by arXiv's existing retry/backoff, or contributes `[]` in the concurrent search fan-outs). Injectable timeout + fake timers in tests.

**3c. GMI-fallback telemetry.** When `OpenAICompatProvider` fires the prompt-JSON fallback (`isStructuredOutputRejection` path), it's currently silent — a permanently-unsupported provider would pay 2× round-trips forever invisibly. Fix: a lightweight module-level counter + a one-line `console.warn` on each fallback, and expose the count via the debug `/api/skills/debug/ping` response (or a `GET /api/debug/fallback-stats`), so it's observable. No behavior change to the fallback itself.

## 4. Export round-trip tests (no UI)

Lock the existing `exportVaultZip`/`importVaultZip` (`src/lib/vault/export.ts`) with round-trip unit tests: populate a `MemoryVaultStorage` (wiki pages + `.scispark/` internals + a binary asset), `exportVaultZip` → `importVaultZip` into a fresh storage → assert every path + byte-identical content (text and binary). Guards the code that gives users a single-file backup; no UI this milestone (the on-disk vault folder is the primary portability story).

## 5. Docs rewrite (04-agent-harness, 05-frontend)

Rewrite `docs/design/04-agent-harness.md` and `docs/design/05-frontend.md` for the M11 local-runtime model: the harness runs **server-side** (skills execute in `/api/skills/*` route handlers via `getServerVault()`, not in the browser); the frontend is UI-only, calling the vault/skills/settings/usage APIs over `fetch` (with `RemoteVaultStorage`), streaming long runs via NDJSON. Add the Lint skill row (server, manual, deterministic+LLM) and the spend-panel/usage-API surface. Keep the parts still accurate; mark superseded client-side-harness claims. Surgical, not a full rewrite.

## Testing

Unit throughout: deterministic lint checks on fixture bundles (orphan/broken/bad-frontmatter/index-drift), the lint skill with MockProvider, review-item creation + fix-changeset application + undo, `summarizeUsage`, the settings write-lock (concurrent cross-module saves don't lose updates), `fetchWithTimeout` (fake timers), fallback counter, export round-trip. Route tests via `setServerVaultForTests` + `setSkillTestOverrides`. **Live gate:** seed a vault with a planted contradiction, run the deep-lint LLM pass once vs GMI, assert a `contradiction` finding + a review item + bounded cost.

## Out of scope

Zip export/import UI; dead-code cleanup (mock-feed subtree, `browserSearchFn`); auto-scheduled lint (manual-trigger only in v1); lint fixes for judgment findings (advisory only); the v1.1 trending per-week-aggregation retrieval improvement; localhost auth token.
