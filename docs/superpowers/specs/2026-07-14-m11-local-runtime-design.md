# M11 — Local Runtime Pivot (Design)

**Status:** approved by Tong 2026-07-14 ("the browser is only for showing UI. runtime is on user" → option A: local Next.js server now, Tauri later). Supersedes the M1 "client-side harness + browser storage (OPFS)" architecture. The old M11 items (Lint Skill, spend panel, export/import QA) move unchanged to **M12**.

## Goal

SciSpark v1 becomes a **local app**: a Next.js server running on the user's machine owns the runtime — the vault as plain files on disk (Node `fs`), the agent harness, and the BYOK keys. The browser opens `localhost` and is **UI only**. Any browser works (no OPFS, no File System Access API, no permission dialogs); the CORS relay becomes just local API routes; keys never enter a webpage.

## Architecture decision

- **Packaging (Tong, option A):** ship as the existing Next.js app run locally (`npm run dev` / `next start`) — exactly how the product is used today. A one-command installer and the **Tauri desktop wrapper are post-v1** layers on top of this same code; nothing in M11 blocks them.
- **What moves server-side:** vault storage, skill/orchestrator execution, settings/keys, changeset application, event logging.
- **What stays in the browser:** rendering, interaction state, display reads (via the vault API), and visualization derivation (graph/Louvain/d3 — rendering-adjacent compute that must be in the page for Sigma/SVG anyway).
- **Deployment story:** the Vercel-deployed app is no longer the v1 product; it remains the documented future hosted tier. The existing `/api/search|fetch|resolve|citations` proxy routes keep working locally unchanged (they simply run on the local server now).

## Components

### 1. `NodeFsVaultStorage` — the vault on disk

`src/lib/vault/node-fs-storage.ts`, implementing the existing `VaultStorage` interface over `node:fs/promises`.

- **Vault path:** `SCISPARK_VAULT` env var, default `~/SciSpark/vault`. Created + scaffolded (schema.md, purpose.md, index.md, …) on first server start via the existing `scaffold` machinery.
- Path traversal guarded (every path resolved and checked to stay under the vault root).
- Passes the existing storage-contract test suite (`storage-contract.ts`) verbatim.
- `MemoryVaultStorage` remains the test double. `OpfsVaultStorage` is **removed from the user path** (deleted or left unreferenced pending M12 cleanup — nothing imports it after M11).

### 2. Vault API + `RemoteVaultStorage` — display reads/writes from the UI

- **Server:** route handlers under `/api/vault/*` exposing the `VaultStorage` operations (read, write, list, delete, exists — mirroring the interface 1:1) plus **`POST /api/vault/changeset`** which runs `applyChangeset`/`revertChangeset` **server-side** so atomicity/undo never depends on per-file HTTP writes.
- **Client:** `RemoteVaultStorage implements VaultStorage` (`src/lib/vault/remote-storage.ts`) proxying over `fetch` to those routes. `getOpenVault()` in the browser returns it — **every existing page/component keeps working unchanged** because they already program against the `VaultStorage` interface. This is the pivot's key cost-saver: no page rewrites for reads.
- Changeset-applying UI paths call the changeset endpoint (a thin client helper replaces direct `applyChangeset` imports in client code).

### 3. Skills API — orchestrators run on the server

Route handlers under `/api/skills/*`, one per surface, each a thin wrapper that builds `NodeFsVaultStorage` + server-side settings + a Node `searchFn` and invokes the **existing orchestrator unchanged** (they are already runtime-portable — every live gate runs them in Node):

| Route | Orchestrator |
|---|---|
| `POST /api/skills/feed/refresh` | `runFeed` (SSE progress: funnel stages) |
| `POST /api/skills/digest` | digest generation |
| `POST /api/skills/ingest` | two-step ingest (SSE progress) |
| `POST /api/skills/ask` | Reading-Companion select-to-ask |
| `POST /api/skills/chat` | KB chat |
| `POST /api/skills/spark/quick` | `runQuickSpark` (+ `saveSeed`) |
| `POST /api/skills/spark/deep` | `runDeepSpark` (SSE: onPhase) |
| `POST /api/skills/spark/estimate` | `estimateDeepSparkCost` |
| `POST /api/skills/trending/refresh` | `runTrendingDashboard` (SSE: onProgress) |
| `POST /api/skills/companion/utterance` | companion utterance skill |
| `POST /api/skills/consolidate` | Memory-Consolidation |

- **Long-running runs stream progress via SSE** (Deep Spark phases, feed funnel, trending per-field); short runs are plain JSON.
- Client pages swap their direct orchestrator calls for `fetch`/EventSource against these routes; UI state machines (confirm dialogs, progress, double-spend serialization, stale-while-revalidate) are preserved as-is.
- In-flight double-spend guards move with the orchestrators (the per-storage WeakMap guards now key on the server's singleton storage — strictly stronger: they now protect across tabs too).

### 4. Settings & keys — server-side only

- `settings.json` stays at `vault/.scispark/settings.json`, read/written **by the server**. `GET /api/settings` returns settings **with key values redacted** (presence flags only); `PUT /api/settings` accepts updates (including new keys) — the browser never receives stored key material back.
- All `loadSettings` calls in client components are replaced by the settings API; `buildProvider` runs only server-side.

### 5. Security posture (v1, single-user local)

- The server binds localhost (Next.js default). No auth token in v1 — same trust model as any local dev tool; a token gate is noted as post-v1 hardening (needed before Tauri exposes it or anything binds non-loopback).
- Prompt-injection, changeset, and budget rules are unchanged — the harness enforcement all runs server-side now.

### 6. Docs

`02-system.md` and `03-backend.md` rewritten for the local-runtime model (browser = UI; local server = runtime; hosted tier = future). `01-product.md` storage/entry passages updated. CLAUDE.md status + decision log. The M1 OPFS decision is recorded as superseded (2026-07-14).

## Error handling

- Vault API errors surface through the same error states pages already have (storage errors were always possible).
- SSE streams end with a terminal `result` or `error` event; client falls back to its existing `LlmErrorMessage` rendering.
- Server not running → the browser can't load the app at all (it *is* the server) — no split-brain state possible.

## Testing

- `NodeFsVaultStorage` against the existing storage-contract suite + traversal-guard tests (real `fs` in a temp dir — Node-native, no browser needed).
- Vault API routes: request→storage round-trip tests via route-handler invocation with a memory storage.
- `RemoteVaultStorage` against the storage-contract suite over a mocked `fetch` bound to real route handlers (closing the loop client↔server in one test).
- Skills API: one route tested end-to-end with MockProvider (assert the orchestrator ran server-side and the response/SSE shape); the rest are thin identical wrappers, spot-tested.
- **Live gate:** start the local server, drive one real skill route (trending refresh, cheapest) end-to-end vs GMI — proving browser-free runtime.
- Browser-manual checklist: each surface exercised once against the local server.

## Out of scope (M11)

Tauri wrapper; packaged installer; auth token; multi-user anything; the M12 items (Lint Skill, spend panel, export/import round-trip QA — export/import matters less now that the vault is a visible folder, but stays on M12 for backup workflows); removal-vs-retention cleanup of remaining browser-only code paths beyond OPFS dereferencing.
