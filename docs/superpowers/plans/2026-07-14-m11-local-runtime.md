# M11 Local Runtime Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the runtime to a local Next.js server — vault as plain files on disk (Node fs), orchestrators + keys server-side; the browser becomes UI-only over a vault API + skills API.

**Architecture:** Three seams, built in order: (1) `NodeFsVaultStorage` + a server vault singleton; (2) `/api/vault/*` + `RemoteVaultStorage` so all existing client reads/writes keep working against disk; (3) `/api/skills/*` routes that run the existing (already Node-portable) orchestrators server-side, with streamed NDJSON progress for long runs — client surfaces swap direct orchestrator calls for fetches, keeping their state machines. Settings/keys become server-only (redacted GET). Spec: `docs/superpowers/specs/2026-07-14-m11-local-runtime-design.md`.

**Tech Stack:** TypeScript, Next.js 16 App Router route handlers (Node runtime), `node:fs/promises`, vitest.

## Global Constraints

- **Browser = UI only.** After M11 no client component imports an orchestrator, `runSkill`, `applyChangeset`/`revertChangeset`, `loadSettings` (LLM), or constructs an LLM provider. Enforce with a final grep gate (Task 10).
- **Keys never enter the browser.** `GET /api/settings` returns key *presence*, never values.
- **`VaultStorage` interface unchanged** (`src/lib/vault/storage.ts`: read/write/readBinary/writeBinary/delete/list). `NodeFsVaultStorage` and `RemoteVaultStorage` must pass the existing `storageContractTests` (`src/lib/vault/storage-contract.ts`) verbatim.
- **Vault path:** `SCISPARK_VAULT` env var; default `~/SciSpark/vault` (`os.homedir()`). Every resolved path must stay under the vault root (traversal guard).
- **Changesets apply server-side only** (`POST /api/vault/changeset`) — atomicity never depends on per-file HTTP writes.
- **Long-run progress = streamed NDJSON over fetch** (one JSON object per line: `{type:"progress",...}` events then a terminal `{type:"result"|"error",...}`). POST-compatible (EventSource is GET-only); satisfies the spec's SSE intent.
- **Orchestrators unchanged.** Routes are thin wrappers; behavior differences are bugs.
- Source-hygiene: no raw control bytes; write NUL as ` `.
- All route handlers export Node-runtime handlers (no `export const runtime = "edge"`).

---

### Task 1: NodeFsVaultStorage + vault path resolution

**Files:**
- Create: `src/lib/vault/node-fs-storage.ts`, `src/lib/vault/vault-path.ts`
- Test: `src/lib/vault/__tests__/node-fs-storage.test.ts`

**Interfaces:**
- Consumes: `VaultStorage` (`src/lib/vault/storage.ts`), `storageContractTests(name, make)` (`src/lib/vault/storage-contract.ts`).
- Produces: `class NodeFsVaultStorage implements VaultStorage { constructor(root: string) }`; `function resolveVaultRoot(env?: NodeJS.ProcessEnv): string` (SCISPARK_VAULT || ~/SciSpark/vault).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/vault/__tests__/node-fs-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { storageContractTests } from "../storage-contract"
import { NodeFsVaultStorage } from "../node-fs-storage"
import { resolveVaultRoot } from "../vault-path"

describe("NodeFsVaultStorage", () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "scispark-vault-")) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  describe("storage contract", () => {
    // Each contract test gets a fresh subdirectory so tests don't interfere.
    let n = 0
    storageContractTests("NodeFsVaultStorage", async () => new NodeFsVaultStorage(join(mkdtempSync(join(tmpdir(), "scispark-c-")), String(n++))))
  })

  it("rejects path traversal on every operation", async () => {
    const s = new NodeFsVaultStorage(dir)
    for (const bad of ["../outside.md", "a/../../outside.md", "/etc/passwd"]) {
      await expect(s.read(bad)).rejects.toThrow(/outside the vault|traversal/i)
      await expect(s.write(bad, "x")).rejects.toThrow(/outside the vault|traversal/i)
      await expect(s.delete(bad)).rejects.toThrow(/outside the vault|traversal/i)
    }
  })

  it("writeBinary/readBinary round-trips bytes losslessly", async () => {
    const s = new NodeFsVaultStorage(dir)
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128])
    await s.writeBinary("assets/x.bin", bytes)
    expect(Array.from((await s.readBinary("assets/x.bin"))!)).toEqual(Array.from(bytes))
  })
})

describe("resolveVaultRoot", () => {
  it("prefers SCISPARK_VAULT; falls back to ~/SciSpark/vault", () => {
    expect(resolveVaultRoot({ SCISPARK_VAULT: "/tmp/custom" } as NodeJS.ProcessEnv)).toBe("/tmp/custom")
    const def = resolveVaultRoot({} as NodeJS.ProcessEnv)
    expect(def.endsWith("/SciSpark/vault")).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/node-fs-storage.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/vault/vault-path.ts`:

```ts
import { homedir } from "node:os"
import { join } from "node:path"

/** Vault root on disk: SCISPARK_VAULT env override, else ~/SciSpark/vault. */
export function resolveVaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SCISPARK_VAULT?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), "SciSpark", "vault")
}
```

`src/lib/vault/node-fs-storage.ts`:

```ts
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import type { VaultStorage } from "./storage"

/**
 * VaultStorage over a real directory on disk (M11 local-runtime pivot,
 * docs/superpowers/specs/2026-07-14-m11-local-runtime-design.md). The vault is
 * plain files the user owns; this class is the server-side storage the whole
 * runtime uses. Every path is resolved and must stay under the root.
 */
export class NodeFsVaultStorage implements VaultStorage {
  private root: string
  constructor(root: string) {
    this.root = resolve(root)
  }

  private abs(path: string): string {
    const full = resolve(this.root, path)
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`path escapes outside the vault root: ${path}`)
    }
    return full
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(this.abs(path), "utf8")
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
      throw e
    }
  }

  async write(path: string, content: string): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content, "utf8")
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.abs(path))
      return new Uint8Array(buf)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
      throw e
    }
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, data)
  }

  async delete(path: string): Promise<void> {
    await rm(this.abs(path), { force: true })
  }

  async list(prefix?: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (dirAbs: string, rel: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dirAbs, { withFileTypes: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return
        throw e
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(join(dirAbs, entry.name), childRel)
        else out.push(childRel)
      }
    }
    await walk(this.root, "")
    const filtered = prefix ? out.filter((p) => p.startsWith(prefix)) : out
    return filtered.sort()
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/node-fs-storage.test.ts && npx tsc --noEmit` → PASS, clean. (If a contract test assumes empty-dir cleanup behavior that fs `rm` of files leaves dangling empty dirs for, check the contract's delete/list expectations — `list` only returns files, so empty dirs are invisible and fine.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/node-fs-storage.ts src/lib/vault/vault-path.ts src/lib/vault/__tests__/node-fs-storage.test.ts
git commit -m "feat(runtime): NodeFsVaultStorage (vault as plain files on disk) + vault path resolution"
```

---

### Task 2: Server vault singleton + /api/vault routes + server-side changeset endpoint

**Files:**
- Create: `src/lib/server/vault.ts`, `src/app/api/vault/file/route.ts`, `src/app/api/vault/list/route.ts`, `src/app/api/vault/changeset/route.ts`
- Test: `src/lib/server/__tests__/vault-api.test.ts`

**Interfaces:**
- Consumes: `NodeFsVaultStorage`, `resolveVaultRoot` (Task 1); `openVault` (`src/lib/vault/scaffold.ts`); `applyChangeset`, `revertChangeset`, `Changeset` (`src/lib/vault/changesets.ts` — read the real signatures: `applyChangeset(storage, cs)`, `revertChangeset(storage, cs)` at lines 67/124).
- Produces:
  - `async function getServerVault(): Promise<VaultStorage>` (memoized NodeFs + scaffold; test override `setServerVaultForTests(storage | null)`)
  - HTTP surface (all Node runtime):
    - `GET /api/vault/file?path=…` → 200 body bytes (`content-type: application/octet-stream`) or 404
    - `PUT /api/vault/file?path=…` (body = raw bytes; header `x-vault-text: 1` for text writes) → 204
    - `DELETE /api/vault/file?path=…` → 204
    - `GET /api/vault/list?prefix=…` → `{ paths: string[] }`
    - `POST /api/vault/changeset` body `{ action: "apply" | "revert", changeset: Changeset }` → `{ ok: true }` or 409/400 with `{ error }`

**Details:** Handlers are thin: parse → `getServerVault()` → storage op → response. Text vs binary: `PUT` with `x-vault-text: 1` decodes body as UTF-8 and calls `write` (else `writeBinary`); `GET` returns bytes from `readBinary` (text callers decode — lossless for UTF-8 text). Changeset conflicts (`ChangesetConflictError` or message match) → 409 with the message. Path is required — missing/empty → 400.

- [ ] **Step 1: Write failing tests** — invoke the route handlers as functions with `new Request(...)`, with `setServerVaultForTests(new MemoryVaultStorage())`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import * as fileRoute from "../../../app/api/vault/file/route"
import * as listRoute from "../../../app/api/vault/list/route"
import * as changesetRoute from "../../../app/api/vault/changeset/route"

describe("vault API", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })

  it("PUT text → GET round-trips; 404 for missing; DELETE removes", async () => {
    const put = await fileRoute.PUT(new Request("http://x/api/vault/file?path=wiki/a.md", {
      method: "PUT", headers: { "x-vault-text": "1" }, body: "hello",
    }))
    expect(put.status).toBe(204)
    const got = await fileRoute.GET(new Request("http://x/api/vault/file?path=wiki/a.md"))
    expect(got.status).toBe(200)
    expect(new TextDecoder().decode(await got.arrayBuffer())).toBe("hello")
    expect((await fileRoute.GET(new Request("http://x/api/vault/file?path=nope.md"))).status).toBe(404)
    expect((await fileRoute.DELETE(new Request("http://x/api/vault/file?path=wiki/a.md", { method: "DELETE" }))).status).toBe(204)
    expect(await storage.read("wiki/a.md")).toBeNull()
  })

  it("GET /api/vault/list filters by prefix", async () => {
    await storage.write("wiki/a.md", "x"); await storage.write("notes/n.md", "x")
    const res = await listRoute.GET(new Request("http://x/api/vault/list?prefix=wiki/"))
    expect(await res.json()).toEqual({ paths: ["wiki/a.md"] })
  })

  it("missing path param → 400", async () => {
    expect((await fileRoute.GET(new Request("http://x/api/vault/file"))).status).toBe(400)
  })

  it("POST /api/vault/changeset applies atomically server-side and 409s on conflict", async () => {
    const cs = { id: "cs-1", createdAt: "2026-07-14T00:00:00Z", changes: [{ path: "wiki/new.md", before: null, after: "content" }] }
    const ok = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(ok.status).toBe(200)
    expect(await storage.read("wiki/new.md")).toBe("content")
    // Re-applying the same changeset now conflicts (before:null but file exists).
    const dup = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(dup.status).toBe(409)
  })
})
```

**Adapt the `cs` literal to the real `Changeset` type** in `src/lib/vault/changesets.ts` (read it first — field names like `changes[].before/after` must match exactly; if the real type carries provenance fields (skill/model/sources), include minimal valid values).

- [ ] **Step 2: Run → FAIL. Implement.**

`src/lib/server/vault.ts`:

```ts
import type { VaultStorage } from "../vault/storage"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { resolveVaultRoot } from "../vault/vault-path"
import { openVault } from "../vault/scaffold"

let vaultPromise: Promise<VaultStorage> | null = null
let testOverride: VaultStorage | null = null

/** Test hook: force the server vault (pass null to clear). */
export function setServerVaultForTests(storage: VaultStorage | null): void {
  testOverride = storage
  vaultPromise = null
}

/** The server-side vault singleton: NodeFs at the resolved root, scaffolded once. */
export function getServerVault(): Promise<VaultStorage> {
  if (testOverride) return Promise.resolve(testOverride)
  if (!vaultPromise) {
    vaultPromise = (async () => {
      const storage = new NodeFsVaultStorage(resolveVaultRoot())
      await openVault(storage)
      return storage
    })().catch((err) => {
      vaultPromise = null
      throw err
    })
  }
  return vaultPromise
}
```

Route handlers follow the shapes asserted above; changeset route catches conflict errors (match `ChangesetConflictError` by `instanceof` if exported, else `/conflict/i` on the message) → 409, malformed body → 400, other errors → 500 `{error}`.

- [ ] **Step 3: Run → PASS; `npx tsc --noEmit` clean; full suite green.**

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/vault.ts src/app/api/vault src/lib/server/__tests__/vault-api.test.ts
git commit -m "feat(runtime): server vault singleton + /api/vault file/list/changeset routes"
```

---

### Task 3: RemoteVaultStorage + browser get-vault swap

**Files:**
- Create: `src/lib/vault/remote-storage.ts`
- Modify: `src/lib/vault/get-vault.ts`
- Test: `src/lib/vault/__tests__/remote-storage.test.ts`

**Interfaces:**
- Produces: `class RemoteVaultStorage implements VaultStorage { constructor(fetchFn?: typeof fetch, base?: string) }` — read/write via the Task 2 routes (`write` sends `x-vault-text: 1`; `read` decodes UTF-8; 404 → null; non-ok → throw with server `{error}` when parseable).
- Modifies: `getVault()` in `get-vault.ts` — in the browser return `new RemoteVaultStorage()`; keep `MemoryVaultStorage` for non-browser (test/SSR) contexts; **remove the OpfsVaultStorage import/branch**. `getOpenVault()` no longer scaffolds client-side (the server scaffolds in `getServerVault`) — it just resolves the storage (keep the memoization + retry-on-reject shape; call `openVault` only for the Memory fallback so tests keep working).

**Details:** Contract-test RemoteVaultStorage by binding its `fetchFn` to the REAL Task 2 route handlers dispatching on method+pathname (closing the client↔server loop in-process):

- [ ] **Step 1: Write failing tests**

```ts
import { describe, beforeEach } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { setServerVaultForTests } from "../../server/vault"
import * as fileRoute from "../../../app/api/vault/file/route"
import * as listRoute from "../../../app/api/vault/list/route"
import { storageContractTests } from "../storage-contract"
import { RemoteVaultStorage } from "../remote-storage"

// A fetch that dispatches to the real route handlers in-process.
function routeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(input), init)
    const { pathname } = new URL(req.url)
    if (pathname === "/api/vault/file") {
      if (req.method === "GET") return fileRoute.GET(req)
      if (req.method === "PUT") return fileRoute.PUT(req)
      if (req.method === "DELETE") return fileRoute.DELETE(req)
    }
    if (pathname === "/api/vault/list") return listRoute.GET(req)
    return new Response("not found", { status: 404 })
  }) as typeof fetch
}

describe("RemoteVaultStorage (against real route handlers)", () => {
  storageContractTests("RemoteVaultStorage", async () => {
    setServerVaultForTests(new MemoryVaultStorage())
    return new RemoteVaultStorage(routeFetch(), "http://local")
  })
})
```

- [ ] **Step 2: Run → FAIL. Implement RemoteVaultStorage** (thin fetch wrappers per the Task 2 HTTP shapes; encode `path`/`prefix` with `encodeURIComponent`). Update `get-vault.ts` per Interfaces above.

- [ ] **Step 3: Run remote-storage tests + FULL suite + build.** The full suite matters here: get-vault's browser branch changed; every existing page still compiles and unit tests (which use Memory) stay green. `npm run build` green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/vault/remote-storage.ts src/lib/vault/get-vault.ts src/lib/vault/__tests__/remote-storage.test.ts
git commit -m "feat(runtime): RemoteVaultStorage — browser reads/writes go through the local vault API"
```

---

### Task 4: Settings API (keys never reach the browser)

**Files:**
- Create: `src/app/api/settings/route.ts`, `src/lib/llm/settings-client.ts`
- Modify: `src/app/profile/page.tsx`, `src/app/debug/llm/page.tsx` (their LLM-settings sections)
- Test: `src/lib/server/__tests__/settings-api.test.ts`

**Interfaces:**
- `GET /api/settings` → `{ settings: RedactedSettings }` where `RedactedSettings` = `LLMSettings` minus key values: `keys: Partial<Record<ProviderId, { present: true }>>` (plus tierModels/dailyBudgetUsd/baseUrls verbatim).
- `PUT /api/settings` body `{ patch: SettingsPatch }` where `SettingsPatch` = partial `LLMSettings`; a key value present in the patch replaces the stored key; a key set to `""` deletes it; omitted keys are untouched. Persisted via the existing `saveSettings` (`src/lib/llm/settings.ts` — read its real save API first and adapt).
- Client helper `src/lib/llm/settings-client.ts`: `loadRedactedSettings(fetchFn?)`, `patchSettings(patch, fetchFn?)`.

**Details:** Read the two pages first; swap their direct `loadSettings`/`saveSettings` usage to the client helper; key inputs become write-only (placeholder "•••• saved" when present). Trending/companion settings sections (non-secret) may keep using RemoteVaultStorage directly — they're vault files, not secrets.

Tests: GET never contains a key string (seed a storage with a key and assert the response JSON stringified does NOT contain it); PUT round-trips a budget change; PUT with `""` deletes a key; PUT never logs the key.

- [ ] **Step 1: failing tests → Step 2: implement → Step 3: `npx vitest run src/lib/server src/lib/llm && npx tsc --noEmit && npm run build` green → Step 4: Commit**

```bash
git add src/app/api/settings src/lib/llm/settings-client.ts src/app/profile/page.tsx src/app/debug/llm/page.tsx src/lib/server/__tests__/settings-api.test.ts
git commit -m "feat(runtime): settings API with redacted keys; key material never reaches the browser"
```

---

### Task 5: Skills API foundation + NDJSON streaming + trending routes + page swaps

**Files:**
- Create: `src/lib/server/skill-route.ts` (shared helpers), `src/app/api/skills/trending/refresh/route.ts`, `src/app/api/skills/trending/auto-refresh/route.ts`, `src/lib/trending/client.ts`
- Modify: `src/app/trending/page.tsx`, `src/app/page.tsx`
- Test: `src/lib/server/__tests__/skill-route.test.ts`, `src/lib/server/__tests__/trending-api.test.ts`

**Interfaces:**
- `src/lib/server/skill-route.ts` produces:
  - `function jsonSkillRoute<TIn, TOut>(handler: (input: TIn, vault: VaultStorage) => Promise<TOut>): (req: Request) => Promise<Response>` — parses JSON body, `getServerVault()`, runs, 200 `{result}` / 500 `{error}`.
  - `function ndjsonSkillRoute<TIn>(handler: (input: TIn, vault: VaultStorage, emit: (event: object) => void) => Promise<object>): (req: Request) => Promise<Response>` — returns a `ReadableStream` Response (`content-type: application/x-ndjson`); `emit` writes `{...}\n` progress lines; handler's return value is written as `{"type":"result",...}\n`; a throw writes `{"type":"error","message":...}\n`. Stream always terminates.
  - Client-side consumer `readNdjson(res: Response, onEvent: (e: any) => void): Promise<any>` — reads lines, calls onEvent per progress line, resolves with the `result` event or rejects on `error` (exported from the same file is fine — it's isomorphic).
- Trending routes:
  - `POST /api/skills/trending/refresh` body `{ fields: TrackedField[] }` → NDJSON: progress `{type:"progress", field}` per `onProgress`, result = the `TrendingDashboard`.
  - `POST /api/skills/trending/auto-refresh` body `{}` → JSON `{result: "refreshed"|"fresh"|"no-fields"}` (server builds its own searchFn/settings — see below).
- `src/lib/trending/client.ts`: `refreshTrendingDashboard(fields, onField?, fetchFn?)`, `autoRefreshTrending(fetchFn?)`.

**Details (the pattern every later task copies):** the route builds the orchestrator's deps server-side: `getServerVault()`, `loadSettings(vault)`, and a **Node searchFn**. For the Node searchFn, extract the live-gate helper into production code: create `src/lib/papers/node-search.ts` exporting `nodeSearchFn(): SearchFn` (arxiv+openalex via the search-core adapters directly, s2/pubmed→openalex remap — lift the implementation from `src/lib/spark/__tests__/live-spark.test.ts`'s helper, which is already proven). `browserSearchFn` remains for nothing after M11 — the trending/feed/spark pages stop passing searchFns entirely (the server owns it).

Then swap the two client surfaces:
- `src/app/trending/page.tsx`: `refresh()` calls `refreshTrendingDashboard(fields, (f) => setRefreshingField(f))` instead of `runTrendingDashboard`; remove `loadSettings`/`browserSearchFn` imports. Cache reads (`loadDashboard`) keep working via RemoteVaultStorage — unchanged.
- `src/app/page.tsx`: the fire-and-forget block calls `autoRefreshTrending()` instead of importing `maybeAutoRefreshTrending`/`loadSettings`/`browserSearchFn`.

Tests: `skill-route.test.ts` exercises both helpers with fake handlers (JSON happy/error; NDJSON progress ordering + terminal result + terminal error + stream closes). `trending-api.test.ts` invokes the refresh route with `setServerVaultForTests(memory)` + a MockProvider injected — **check how routes can receive a provider override for tests**: add an optional `providerOverride` threading in the route module via a `setSkillTestOverrides({providerOverride?, searchFn?})` test hook in `skill-route.ts` (documented test-only), so route tests never hit the network. Assert: NDJSON events arrive per field, result parses as a dashboard, cache written to the test vault.

- [ ] Steps: failing tests → implement → `npx vitest run src/lib/server src/lib/trending && npx tsc --noEmit && npm run build && npx vitest run` all green → Commit:

```bash
git add src/lib/server/skill-route.ts src/lib/papers/node-search.ts src/app/api/skills/trending src/lib/trending/client.ts src/app/trending/page.tsx src/app/page.tsx src/lib/server/__tests__
git commit -m "feat(runtime): skills API foundation (NDJSON streaming) + trending routes; trending UI is fetch-only"
```

---

### Task 6: Feed + consolidation routes + FeedRefreshBar swap

**Files:**
- Create: `src/app/api/skills/feed/refresh/route.ts`, `src/app/api/skills/consolidate/route.ts`, `src/lib/skills/feed-client.ts`
- Modify: `src/components/feed/FeedRefreshBar.tsx`
- Test: `src/lib/server/__tests__/feed-api.test.ts`

**Interfaces:** `POST /api/skills/feed/refresh` body `{}` → NDJSON progress (funnel stage events — read `runFeed`'s progress callback shape in `src/lib/skills/feed.ts:502` and mirror it) with result = `FeedResult`. `POST /api/skills/consolidate` → JSON result (read the consolidation orchestrator's real name/signature in the module FeedRefreshBar imports it from). Client: `refreshFeed(onStage?, fetchFn?)`, `consolidate(fetchFn?)`.

**Details:** Read `FeedRefreshBar.tsx` first — preserve its exact UI states (stage label, error affordance, onUpdated callback contract with `src/app/page.tsx`). The server route builds settings + nodeSearchFn like Task 5. Tests mirror trending-api.test.ts with MockProvider via the test hook.

- [ ] Steps: failing tests → implement → targeted + full suite + tsc + build green → Commit:

```bash
git add src/app/api/skills/feed src/app/api/skills/consolidate src/lib/skills/feed-client.ts src/components/feed/FeedRefreshBar.tsx src/lib/server/__tests__/feed-api.test.ts
git commit -m "feat(runtime): feed + consolidation routes; FeedRefreshBar is fetch-only"
```

---

### Task 7: Digest + ingest + undo routes + papers page swap

**Files:**
- Create: `src/app/api/skills/digest/route.ts`, `src/app/api/skills/ingest/route.ts`, `src/app/api/skills/ingest/undo/route.ts`, `src/lib/skills/ingest-client.ts`
- Modify: `src/app/papers/page.tsx`
- Test: `src/lib/server/__tests__/ingest-api.test.ts`

**Interfaces:** Read `src/app/papers/page.tsx` + `src/lib/skills/digest.ts` + `src/lib/skills/ingest.ts` first (real signatures: `generateDigest(vault, paper, opts)`, `runSkill(ingestSkill, …)`, `undoIngest`). Routes: digest = JSON (`{paper}` in → `DigestResult` out, including the `fromCache`/cost fields the page shows); ingest = NDJSON (phases acquiring→snapshotting→digesting→ingesting mirrored as progress events; result = `IngestOutput` + changesetId); undo = JSON (`{changesetId}` → ok). Client helper mirrors the page's current call shapes so the page diff is minimal.

**Details:** The page keeps ALL its state machine (phases, celebration trigger, undo affordance) — only the execution moves. The `/api/fetch` relay is now same-origin from the server's perspective: the ingest orchestrator's acquire step runs server-side and may call the relay logic directly (read `src/lib/wiki/acquire.ts` — if it fetches via `/api/fetch` URL, point it at the local absolute URL or invoke the relay's underlying function `src/lib/server/fetch-relay.ts` directly server-side; choose the direct-function path and note it).

- [ ] Steps: failing tests (MockProvider; assert phases stream in order, changeset applied to test vault, undo reverts) → implement → all suites + tsc + build green → Commit:

```bash
git add src/app/api/skills/digest src/app/api/skills/ingest src/lib/skills/ingest-client.ts src/app/papers/page.tsx src/lib/server/__tests__/ingest-api.test.ts
git commit -m "feat(runtime): digest/ingest/undo routes; papers page is fetch-only"
```

---

### Task 8: Spark routes + SparkPanel/DeepProgress swap

**Files:**
- Create: `src/app/api/skills/spark/quick/route.ts`, `src/app/api/skills/spark/seed/route.ts`, `src/app/api/skills/spark/deep/route.ts`, `src/app/api/skills/spark/estimate/route.ts`, `src/lib/spark/client.ts`
- Modify: `src/components/spark/SparkPanel.tsx`, `src/components/spark/DeepProgress.tsx` (if it calls runDeepSpark directly — read it)
- Test: `src/lib/server/__tests__/spark-api.test.ts`

**Interfaces:** quick = JSON (`{direction, clusterPageIds?}` → `QuickSparkResult`); seed = JSON (`{seed, direction}` → saved idea page id — read `saveSeed`'s real signature); deep = NDJSON (`{direction, clusterPageIds?, seedPageId?}`; progress `{type:"progress", phase}` from `onPhase`; result = `DeepSparkResult`); estimate = JSON (`{}` → `{costUsd}`). Client helpers mirror current call shapes.

**Details:** Preserve the M9 spend-safety UI contract exactly: confirm-dialog before deep (estimate fetched first), serialized deep runs (the page's `deepBusy` logic unchanged), honest do_not_generate/abandoned rendering. The deep route's server-side execution also inherits `runDeepSpark`'s own guards. Tests: quick + deep happy paths with MockProvider (deep asserts phase events in pipeline order and an idea page written to the test vault), estimate returns the static number.

- [ ] Steps: failing tests → implement → suites + tsc + build green → Commit:

```bash
git add src/app/api/skills/spark src/lib/spark/client.ts src/components/spark/SparkPanel.tsx src/components/spark/DeepProgress.tsx src/lib/server/__tests__/spark-api.test.ts
git commit -m "feat(runtime): spark quick/seed/deep/estimate routes; spark UI is fetch-only"
```

---

### Task 9: Reader ask + note-capture + companion routes + component swaps

**Files:**
- Create: `src/app/api/skills/ask/route.ts`, `src/app/api/skills/companion/route.ts`, `src/lib/reader/client.ts`, `src/lib/companion/client.ts`
- Modify: `src/components/reader/ReaderView.tsx`, `src/components/companion/useCompanion.ts`
- Test: `src/lib/server/__tests__/ask-companion-api.test.ts`

**Interfaces:** Read `ReaderView.tsx` + `useCompanion.ts` + `src/lib/companion/run.ts` (`runCompanion(args)`) + the reading-companion skill invocation inside ReaderView first. ask = JSON (`{paperKey, selection, question, context…}` matching the current `runSkill` input → the answer output). ReaderView's `applyChangeset` (note capture) switches to the Task 2 changeset endpoint via a small client helper (`applyChangesetRemote(changeset, fetchFn?)` in `src/lib/vault/changeset-client.ts` — create it here if not already needed earlier). companion = JSON (`{trigger, context…}` → `CompanionUtterance | null`).

**Details:** Highlights persistence: check how highlights are saved (likely direct storage writes — those keep working via RemoteVaultStorage untouched). Only LLM execution + changeset application move. Companion chattiness budget/cooldowns: `runCompanion` owns them — they now enforce server-side (stronger, cross-tab).

- [ ] Steps: failing tests (ask returns skill output; companion respects a scripted null; note-capture changeset lands in test vault) → implement → suites + tsc + build green → Commit:

```bash
git add src/app/api/skills/ask src/app/api/skills/companion src/lib/reader/client.ts src/lib/companion/client.ts src/lib/vault/changeset-client.ts src/components/reader/ReaderView.tsx src/components/companion/useCompanion.ts src/lib/server/__tests__/ask-companion-api.test.ts
git commit -m "feat(runtime): reader-ask, note-capture, companion routes; reader/companion UI fetch-only"
```

---

### Task 10: Browser-purity gate + OPFS removal + debug page

**Files:**
- Create: `src/lib/__tests__/browser-purity.test.ts`
- Delete: `src/lib/vault/opfs-storage.ts` (+ its contract-test registration — find it)
- Modify: `src/app/debug/llm/page.tsx` (route through settings API + a debug skill route or gut the direct provider use — read it and choose the minimal compliant form), any straggler imports.

**Details:** The purity gate encodes the milestone's core constraint as a permanent test: for every file under `src/app` and `src/components` (client code), assert NO import of: `@/lib/skills/runner`, orchestrator modules (`spark/quick`, `spark/deep`, `trending/dashboard` runner export — importing types is fine, use import-statement parsing on source text with an allowlist for `import type`), `applyChangeset`/`revertChangeset` from `@/lib/vault/changesets`, `loadSettings`/`saveSettings` from `@/lib/llm/settings`, or `@/lib/llm/providers/*`. Implementation: read files with `node:fs`, regex the import statements, allow `import type`. Also assert `opfs-storage` is imported nowhere, then delete it.

- [ ] Steps: write the gate (it FAILS listing every straggler — this is the work list) → fix stragglers → gate green → full `npx vitest run` + tsc + `npm run build` + lint-baseline green → Commit:

```bash
git add -A src/lib/__tests__/browser-purity.test.ts src
git commit -m "feat(runtime): browser-purity gate; remove OPFS; client code is UI-only"
```

---

### Task 11: Docs rewrite

**Files:**
- Modify: `docs/design/02-system.md`, `docs/design/03-backend.md`, `docs/design/01-product.md` (storage/entry passages), `CLAUDE.md` (status block)

**Details:** Rewrite per the spec: browser = UI; local Next server = runtime (vault at `SCISPARK_VAULT`/`~/SciSpark/vault`, harness + keys server-side, vault API + skills API); hosted/Vercel = future tier; Tauri = post-v1 wrapper on this code; OPFS/FSA model marked superseded (decision already logged in CLAUDE.md). Update CLAUDE.md's status block with M11-in-progress→complete phrasing (not "merged" until merge). Surgical edits, not rewrites of unrelated content.

- [ ] Commit: `docs: rewrite system/backend docs for the local-runtime model (M11)`

---

### Task 12: Live gate — real local server end-to-end

**Files:**
- Create: `scripts/live-local-runtime.mjs` (env-gated script, NOT a vitest test — it spawns a real server)

**Details:** The gate proves the whole pivot: spawn `next dev` (or `next start` after build — dev is fine and faster to boot) on a scratch port with `SCISPARK_VAULT=<tmpdir>` and the `LIVE_LLM_*` env passed through; wait for ready; then via plain `fetch` against `http://localhost:<port>`:
1. `GET /api/vault/list` → scaffolded vault files present (schema.md etc.) — **proves disk scaffold**.
2. `PUT/GET /api/vault/file` round-trip → **proves vault API**; verify the file exists ON DISK at `<tmpdir>` with `node:fs`.
3. `PUT /api/settings` with the GMI key/baseUrl/tier config; `GET /api/settings` → key redacted — **proves key hygiene**.
4. `POST /api/skills/trending/refresh` with one field → NDJSON streams progress + result with real metrics + survey — **proves server-side skill execution vs GMI** (cheapest real skill, ~$0.04).
Print each step's outcome + cost; exit non-zero on any failure; kill the server in a finally. Header comment records the run command:
```
LIVE_LLM_BASE_URL=… LIVE_LLM_MODEL=… LIVE_LLM_API_KEY=… node scripts/live-local-runtime.mjs
```
Without env: steps 1–3 still run (no LLM); step 4 skipped with a notice — so the script doubles as a free smoke test.

- [ ] Steps: write script → run WITHOUT keys (steps 1–3 pass) → full suite + tsc + build green → Commit `test(runtime): live local-server gate (vault on disk + skills API)` → **(controller) run WITH GMI env; record results.**

---

## Self-Review

**Spec coverage:** NodeFs storage + path (T1); vault API + server changesets (T2); RemoteVaultStorage + browser swap (T3); settings/keys server-only (T4); skills API + NDJSON + all real surfaces — trending (T5), feed/consolidation (T6), digest/ingest/undo (T7), spark (T8), ask/note/companion (T9); browser-purity + OPFS removal (T10); docs (T11); live gate (T12). KB chat is still mock (no route needed — verified). Security posture (localhost, no token) needs no task. ✓

**Placeholder scan:** Tasks 4–9 direct the implementer to read named real files for exact signatures before adapting — explicit instruction, not vagueness; all HTTP shapes, route paths, and helper names are pinned here. No TBDs.

**Type consistency:** `VaultStorage` (read/write/readBinary/writeBinary/delete/list) used consistently; `getServerVault`/`setServerVaultForTests` (T2) consumed by T4–T9 tests; `jsonSkillRoute`/`ndjsonSkillRoute`/`readNdjson` (T5) consumed by T6–T9; `nodeSearchFn` (T5) by T6–T8; `applyChangesetRemote` created in T9 (first client need). Event/NDJSON envelope `{type: progress|result|error}` uniform.
