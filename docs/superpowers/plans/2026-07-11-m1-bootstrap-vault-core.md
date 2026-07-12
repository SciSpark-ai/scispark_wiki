# M1: Bootstrap + Vault Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the forked SciSpark frontend running in this repo, and build the fully-tested vault library (markdown+frontmatter knowledge store with changesets, index/log maintenance, OPFS + in-memory storage, zip export) that every later milestone depends on.

**Architecture:** The app is the forked `scispark-app-frontend` (Next.js 16 App Router, React 19, client-side). The vault is a pure-TypeScript library at `src/lib/vault/` with zero React/Next dependencies, tested with Vitest against an in-memory `VaultStorage`; the OPFS implementation is the browser default and is verified via a debug page. Spec: `docs/design/02-system.md` (vault layout, 10 page types, frontmatter contract, changesets).

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Vitest, `yaml` (frontmatter), `fflate` (zip), OPFS (`navigator.storage.getDirectory()`).

## Global Constraints

- Vault layout and frontmatter contract exactly per `docs/design/02-system.md`: required frontmatter keys `type, title, created, updated, tags[], related[], sources[]`; page id = vault-relative path minus `.md`; wikilinks `[[slug]]` in body only.
- The 10 page types: `paper concept method finding comparison author topic note idea project`; reserved root files: `purpose.md schema.md index.md log.md` (never pages).
- `index.md` and `log.md` are written ONLY by deterministic code (never by a model, never by hand in tests).
- The vault library (`src/lib/vault/**`) must not import React, Next, or anything from `src/app`/`src/components`.
- The forked app's Next.js 16 has post-training-data breaking changes — before editing app framework code, read the fork's `AGENTS.md` and bundled docs (fork's `CLAUDE.md` says where). The vault library tasks don't touch framework code.
- Dates in vault files are `YYYY-MM-DD`. Changeset ids: `cs-<epochms>-<4 random hex>`.
- Commit after every task (repo already has git history — `git log --oneline` shows design commits).

---

### Task 1: Fork the frontend into this repo

**Files:**
- Create: entire app tree copied from `/Users/tongshan/Documents/scispark-app-frontend` (excluding `.git`, `node_modules`, `.next`)
- Modify: none yet

**Interfaces:**
- Consumes: nothing
- Produces: a running Next.js app in this repo; `npm run dev` serves it; all later tasks live inside this tree

- [ ] **Step 1: Copy the fork (excluding VCS/build dirs)**

```bash
cd /Users/tongshan/Documents/SciSpark_paper_manager
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' \
  /Users/tongshan/Documents/scispark-app-frontend/ ./
```

Note: the fork has its own `CLAUDE.md`/`README.md`. Ours must win: `git checkout -- CLAUDE.md` if rsync overwrote it (check `git status` first). Keep the fork's `README.md` for now; keep its `AGENTS.md` (Next.js 16 guidance).

- [ ] **Step 2: Restore our CLAUDE.md if clobbered and verify**

```bash
git status --short | head -20
git diff --stat CLAUDE.md && git checkout -- CLAUDE.md
```

Expected: our design-log CLAUDE.md unchanged (fork's Claude guidance lives in `AGENTS.md`).

- [ ] **Step 3: Install and run**

```bash
npm install
npm run dev -- --port 3100 &
sleep 8 && curl -s http://localhost:3100 | head -c 200; kill %1
```

Expected: HTML response containing the app shell (no build errors in output).

- [ ] **Step 4: Run the fork's existing checks**

```bash
npx tsc --noEmit && npm run lint --if-present
```

Expected: both pass (they pass in the source repo).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: fork scispark-app-frontend as M1 app base"
```

---

### Task 2: Generalize user-visible branding (minimal touch)

**Files:**
- Modify: `src/app/layout.tsx` (metadata description), `src/app/chat/page.tsx` (tagline + placeholder strings)

**Interfaces:**
- Consumes: forked app from Task 1
- Produces: no clinical claims in app chrome; mock clinical *content* intentionally remains until M5 (see roadmap)

- [ ] **Step 1: Update metadata in `src/app/layout.tsx`**

Find the `metadata` export; replace title/description values with:

```ts
title: "SciSpark",
description: "AI-powered research radar and knowledge base. Personalized papers daily, AI-digested, grounded in sources.",
```

- [ ] **Step 2: Update chat page copy in `src/app/chat/page.tsx`**

Replace the string `"AI-powered clinical evidence assistant"` with `"AI-powered research assistant"`, and the input placeholder mentioning clinical evidence/treatments/guidelines with `"Ask about papers, methods, or your research questions"`.

- [ ] **Step 3: Verify no other clinical strings in app chrome (content files excluded)**

```bash
grep -rn "clinical" src/app src/components --include='*.tsx' -l | grep -v mock-data || echo CLEAN
```

Expected: `CLEAN` (or only files that render mock *content*, which stays per roadmap).

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/chat/page.tsx
git commit -m "chore: generalize app chrome copy away from clinical framing"
```

---

### Task 3: Vitest infrastructure

**Files:**
- Create: `vitest.config.ts`, `src/lib/vault/__tests__/smoke.test.ts`
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**
- Consumes: Task 1 tree
- Produces: `npm test` runs Vitest over `src/lib/**/__tests__`; later tasks add tests there

- [ ] **Step 1: Install vitest + deps for later tasks**

```bash
npm install -D vitest
npm install yaml fflate
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    include: ["src/lib/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
})
```

- [ ] **Step 3: Add script to `package.json`**

In `"scripts"`, add: `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 4: Write smoke test `src/lib/vault/__tests__/smoke.test.ts`, run it**

```ts
import { describe, it, expect } from "vitest"

describe("vitest infra", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/vault/__tests__/smoke.test.ts
git commit -m "test: add vitest infrastructure for vault library"
```

---

### Task 4: Vault types + frontmatter parse/serialize

**Files:**
- Create: `src/lib/vault/types.ts`, `src/lib/vault/frontmatter.ts`
- Test: `src/lib/vault/__tests__/frontmatter.test.ts`

**Interfaces:**
- Consumes: `yaml` package
- Produces (used by every later task):
  - `PageType` union, `RESERVED_FILES: readonly string[]`
  - `interface Frontmatter { type: string; title: string; created: string; updated: string; tags: string[]; related: string[]; sources: string[]; [key: string]: unknown }`
  - `interface WikiPage { id: string; path: string; frontmatter: Frontmatter; body: string }`
  - `interface FileChange { path: string; before: string | null; after: string | null }`
  - `interface Changeset { id: string; skill: string; model: string; timestamp: string; changes: FileChange[] }`
  - `parseDocument(raw: string): { frontmatter: Frontmatter; body: string }` (throws `FrontmatterError` on malformed/missing required keys)
  - `serializeDocument(frontmatter: Frontmatter, body: string): string`

- [ ] **Step 1: Write the failing test `src/lib/vault/__tests__/frontmatter.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { parseDocument, serializeDocument, FrontmatterError } from "../frontmatter"

const DOC = `---
type: concept
title: "Sparse Autoencoders"
created: 2026-07-11
updated: 2026-07-11
tags: [interpretability, ml]
related: [superposition]
sources: ["2406.01234.pdf"]
---

# Sparse Autoencoders

Body with a [[superposition]] link.
`

describe("parseDocument", () => {
  it("parses frontmatter and body", () => {
    const { frontmatter, body } = parseDocument(DOC)
    expect(frontmatter.type).toBe("concept")
    expect(frontmatter.title).toBe("Sparse Autoencoders")
    expect(frontmatter.tags).toEqual(["interpretability", "ml"])
    expect(frontmatter.sources).toEqual(["2406.01234.pdf"])
    expect(body).toContain("# Sparse Autoencoders")
    expect(body.startsWith("---")).toBe(false)
  })

  it("throws on missing required keys", () => {
    expect(() => parseDocument(`---\ntitle: x\n---\nbody`)).toThrow(FrontmatterError)
  })

  it("throws when file does not start with ---", () => {
    expect(() => parseDocument(`# no frontmatter`)).toThrow(FrontmatterError)
  })
})

describe("serializeDocument", () => {
  it("round-trips", () => {
    const { frontmatter, body } = parseDocument(DOC)
    const out = serializeDocument(frontmatter, body)
    const again = parseDocument(out)
    expect(again.frontmatter).toEqual(frontmatter)
    expect(again.body.trim()).toBe(body.trim())
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/frontmatter.test.ts`
Expected: FAIL — cannot resolve `../frontmatter`.

- [ ] **Step 3: Implement `src/lib/vault/types.ts` and `src/lib/vault/frontmatter.ts`**

`types.ts`:

```ts
export const PAGE_TYPES = [
  "paper", "concept", "method", "finding", "comparison",
  "author", "topic", "note", "idea", "project",
] as const
export type PageType = (typeof PAGE_TYPES)[number]

export const RESERVED_FILES = ["purpose.md", "schema.md", "index.md", "log.md"] as const

export interface Frontmatter {
  type: string
  title: string
  created: string
  updated: string
  tags: string[]
  related: string[]
  sources: string[]
  [key: string]: unknown
}

export interface WikiPage {
  id: string      // vault-relative path minus .md, e.g. "wiki/concepts/sparse-autoencoders"
  path: string    // vault-relative path, e.g. "wiki/concepts/sparse-autoencoders.md"
  frontmatter: Frontmatter
  body: string
}

export interface FileChange {
  path: string
  before: string | null  // null = file did not exist
  after: string | null   // null = file deleted
}

export interface Changeset {
  id: string
  skill: string
  model: string
  timestamp: string  // ISO 8601
  changes: FileChange[]
}
```

`frontmatter.ts`:

```ts
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { Frontmatter } from "./types"

export class FrontmatterError extends Error {}

const REQUIRED_KEYS = ["type", "title", "created", "updated", "tags", "related", "sources"] as const
const ARRAY_KEYS = ["tags", "related", "sources"] as const

export function parseDocument(raw: string): { frontmatter: Frontmatter; body: string } {
  if (!raw.startsWith("---\n")) throw new FrontmatterError("document must start with ---")
  const end = raw.indexOf("\n---", 4)
  if (end === -1) throw new FrontmatterError("unterminated frontmatter block")
  const yamlSrc = raw.slice(4, end)
  const body = raw.slice(end + 4).replace(/^\r?\n/, "")

  let data: unknown
  try {
    data = parseYaml(yamlSrc)
  } catch (e) {
    throw new FrontmatterError(`invalid YAML: ${(e as Error).message}`)
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new FrontmatterError("frontmatter must be a mapping")
  }
  const fm = data as Record<string, unknown>
  for (const key of REQUIRED_KEYS) {
    if (!(key in fm)) throw new FrontmatterError(`missing required key: ${key}`)
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(fm[key])) throw new FrontmatterError(`${key} must be an array`)
  }
  for (const key of ["type", "title"]) {
    if (typeof fm[key] !== "string" || !(fm[key] as string).trim()) {
      throw new FrontmatterError(`${key} must be a non-empty string`)
    }
  }
  // YAML parses bare dates as Date objects; normalize to YYYY-MM-DD strings
  for (const key of ["created", "updated"]) {
    const v = fm[key]
    if (v instanceof Date) fm[key] = v.toISOString().slice(0, 10)
    else if (typeof v !== "string") throw new FrontmatterError(`${key} must be a date string`)
  }
  return { frontmatter: fm as Frontmatter, body }
}

export function serializeDocument(frontmatter: Frontmatter, body: string): string {
  const yamlSrc = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return `---\n${yamlSrc}\n---\n\n${body.trimEnd()}\n`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/frontmatter.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/types.ts src/lib/vault/frontmatter.ts src/lib/vault/__tests__/frontmatter.test.ts
git commit -m "feat(vault): types + strict frontmatter parse/serialize"
```

---

### Task 5: VaultStorage interface + in-memory implementation

**Files:**
- Create: `src/lib/vault/storage.ts`, `src/lib/vault/memory-storage.ts`
- Test: `src/lib/vault/__tests__/memory-storage.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface VaultStorage { read(path: string): Promise<string | null>; write(path: string, content: string): Promise<void>; delete(path: string): Promise<void>; list(prefix?: string): Promise<string[]> }` — paths are vault-relative, `/`-separated, no leading slash; `list` returns sorted paths; `delete` of a missing path is a no-op. (Binary read/write for PDFs is added in the M6 plan.)
  - `class MemoryVaultStorage implements VaultStorage` with `snapshot(): Map<string, string>` for test assertions
  - `storageContractTests(name: string, make: () => Promise<VaultStorage>)` — a shared Vitest suite any implementation must pass (OPFS reuses it in a browser context later)

- [ ] **Step 1: Write the failing test `src/lib/vault/__tests__/memory-storage.test.ts`**

```ts
import { describe } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { storageContractTests } from "../storage-contract"

describe("MemoryVaultStorage", () => {
  storageContractTests("memory", async () => new MemoryVaultStorage())
})
```

And create the shared contract `src/lib/vault/storage-contract.ts` (test helper, lives beside source so the OPFS page can import it):

```ts
import { it, expect } from "vitest"
import type { VaultStorage } from "./storage"

export function storageContractTests(name: string, make: () => Promise<VaultStorage>) {
  it(`${name}: read of missing path returns null`, async () => {
    const s = await make()
    expect(await s.read("wiki/none.md")).toBeNull()
  })
  it(`${name}: write then read round-trips`, async () => {
    const s = await make()
    await s.write("wiki/concepts/a.md", "hello")
    expect(await s.read("wiki/concepts/a.md")).toBe("hello")
  })
  it(`${name}: overwrite replaces content`, async () => {
    const s = await make()
    await s.write("a.md", "one")
    await s.write("a.md", "two")
    expect(await s.read("a.md")).toBe("two")
  })
  it(`${name}: list returns sorted matching paths`, async () => {
    const s = await make()
    await s.write("wiki/concepts/b.md", "x")
    await s.write("wiki/concepts/a.md", "x")
    await s.write("wiki/papers/p.md", "x")
    expect(await s.list("wiki/concepts/")).toEqual(["wiki/concepts/a.md", "wiki/concepts/b.md"])
    expect((await s.list()).length).toBe(3)
  })
  it(`${name}: delete removes; deleting missing is a no-op`, async () => {
    const s = await make()
    await s.write("a.md", "x")
    await s.delete("a.md")
    expect(await s.read("a.md")).toBeNull()
    await s.delete("a.md") // must not throw
  })
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/memory-storage.test.ts`
Expected: FAIL — cannot resolve `../memory-storage`.

- [ ] **Step 3: Implement `storage.ts` and `memory-storage.ts`**

`storage.ts`:

```ts
export interface VaultStorage {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  delete(path: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}
```

`memory-storage.ts`:

```ts
import type { VaultStorage } from "./storage"

export class MemoryVaultStorage implements VaultStorage {
  private files = new Map<string, string>()

  async read(path: string): Promise<string | null> {
    return this.files.has(path) ? (this.files.get(path) as string) : null
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path)
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort()
  }
  snapshot(): Map<string, string> {
    return new Map(this.files)
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/memory-storage.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/storage.ts src/lib/vault/memory-storage.ts src/lib/vault/storage-contract.ts src/lib/vault/__tests__/memory-storage.test.ts
git commit -m "feat(vault): VaultStorage interface, memory impl, shared contract suite"
```

---

### Task 6: OPFS storage implementation

**Files:**
- Create: `src/lib/vault/opfs-storage.ts`
- Test: verified via the debug page in Task 12 (OPFS does not exist in Node/Vitest; the shared contract suite runs there in-browser)

**Interfaces:**
- Consumes: `VaultStorage` from Task 5
- Produces: `class OpfsVaultStorage implements VaultStorage` with `static async create(rootDirName = "scispark-vault"): Promise<OpfsVaultStorage>`

- [ ] **Step 1: Implement `src/lib/vault/opfs-storage.ts`**

```ts
import type { VaultStorage } from "./storage"

export class OpfsVaultStorage implements VaultStorage {
  private constructor(private root: FileSystemDirectoryHandle) {}

  static async create(rootDirName = "scispark-vault"): Promise<OpfsVaultStorage> {
    const opfsRoot = await navigator.storage.getDirectory()
    const root = await opfsRoot.getDirectoryHandle(rootDirName, { create: true })
    return new OpfsVaultStorage(root)
  }

  private async dirFor(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const parts = path.split("/")
    const name = parts.pop() as string
    let dir = this.root
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create })
      } catch {
        return null
      }
    }
    return { dir, name }
  }

  async read(path: string): Promise<string | null> {
    const loc = await this.dirFor(path, false)
    if (!loc) return null
    try {
      const fh = await loc.dir.getFileHandle(loc.name)
      return await (await fh.getFile()).text()
    } catch {
      return null
    }
  }

  async write(path: string, content: string): Promise<void> {
    const loc = await this.dirFor(path, true)
    if (!loc) throw new Error(`cannot create directories for ${path}`)
    const fh = await loc.dir.getFileHandle(loc.name, { create: true })
    const w = await fh.createWritable()
    await w.write(content)
    await w.close()
  }

  async delete(path: string): Promise<void> {
    const loc = await this.dirFor(path, false)
    if (!loc) return
    try {
      await loc.dir.removeEntry(loc.name)
    } catch {
      /* missing = no-op */
    }
  }

  async list(prefix = ""): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: FileSystemDirectoryHandle, base: string) => {
      for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        const p = base ? `${base}/${name}` : name
        if (handle.kind === "file") {
          if (p.startsWith(prefix)) out.push(p)
        } else {
          await walk(handle as FileSystemDirectoryHandle, p)
        }
      }
    }
    await walk(this.root, "")
    return out.sort()
  }
}
```

- [ ] **Step 2: Type-check (no unit test possible in Node)**

Run: `npx tsc --noEmit`
Expected: pass. (Runtime verification happens on the Task 12 debug page, which runs the Task 5 contract suite in-browser.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/vault/opfs-storage.ts
git commit -m "feat(vault): OPFS storage implementation (browser-verified in debug page)"
```

---

### Task 7: Wikilink extraction + bundle loader

**Files:**
- Create: `src/lib/vault/wikilinks.ts`, `src/lib/vault/bundle.ts`
- Test: `src/lib/vault/__tests__/wikilinks.test.ts`, `src/lib/vault/__tests__/bundle.test.ts`

**Interfaces:**
- Consumes: `parseDocument` (Task 4), `VaultStorage` (Task 5), `RESERVED_FILES` (Task 4)
- Produces:
  - `extractWikilinks(body: string): string[]` — unique slugs from `[[slug]]` / `[[slug|label]]`, ignoring fenced code blocks and inline code
  - `interface Bundle { pages: Map<string, WikiPage>; links: Array<{ from: string; to: string }>; errors: Array<{ path: string; message: string }> }`
  - `loadBundle(storage: VaultStorage): Promise<Bundle>` — loads every `wiki/**/*.md`; reserved root files and non-wiki paths excluded; unparseable pages land in `errors`, never throw
  - `resolveLink(bundle: Bundle, slug: string): WikiPage | null` — a `[[slug]]` matches the page whose id's final segment equals the slug
  - `backlinks(bundle: Bundle, id: string): string[]`

- [ ] **Step 1: Write failing tests**

`src/lib/vault/__tests__/wikilinks.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { extractWikilinks } from "../wikilinks"

describe("extractWikilinks", () => {
  it("finds plain and labeled links, deduped", () => {
    expect(extractWikilinks("See [[saint-protocol]] and [[tms|TMS therapy]] and [[saint-protocol]].")).toEqual([
      "saint-protocol",
      "tms",
    ])
  })
  it("ignores code fences and inline code", () => {
    const body = "```\n[[not-a-link]]\n```\nand `[[also-not]]` but [[real]]"
    expect(extractWikilinks(body)).toEqual(["real"])
  })
})
```

`src/lib/vault/__tests__/bundle.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { serializeDocument } from "../frontmatter"
import { loadBundle, resolveLink, backlinks } from "../bundle"
import type { Frontmatter } from "../types"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type, title, created: "2026-07-11", updated: "2026-07-11",
  tags: [], related: [], sources: ["s.pdf"], ...extra,
})

let storage: MemoryVaultStorage
beforeEach(async () => {
  storage = new MemoryVaultStorage()
  await storage.write("wiki/concepts/saint-protocol.md",
    serializeDocument(fm("concept", "SAINT Protocol"), "Uses [[tms]]."))
  await storage.write("wiki/methods/tms.md",
    serializeDocument(fm("method", "TMS"), "A method."))
  await storage.write("index.md", "# Index (reserved, not a page)")
  await storage.write("wiki/broken.md", "no frontmatter here")
})

describe("loadBundle", () => {
  it("loads pages with path-as-id, skips reserved, collects errors", async () => {
    const b = await loadBundle(storage)
    expect([...b.pages.keys()].sort()).toEqual(["wiki/concepts/saint-protocol", "wiki/methods/tms"])
    expect(b.pages.get("wiki/concepts/saint-protocol")!.frontmatter.title).toBe("SAINT Protocol")
    expect(b.errors).toHaveLength(1)
    expect(b.errors[0].path).toBe("wiki/broken.md")
  })
  it("derives link edges from wikilinks", async () => {
    const b = await loadBundle(storage)
    expect(b.links).toEqual([{ from: "wiki/concepts/saint-protocol", to: "wiki/methods/tms" }])
  })
  it("resolveLink matches by final id segment; backlinks invert edges", async () => {
    const b = await loadBundle(storage)
    expect(resolveLink(b, "tms")!.id).toBe("wiki/methods/tms")
    expect(resolveLink(b, "nope")).toBeNull()
    expect(backlinks(b, "wiki/methods/tms")).toEqual(["wiki/concepts/saint-protocol"])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/wikilinks.test.ts src/lib/vault/__tests__/bundle.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`wikilinks.ts`:

```ts
const FENCE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g

export function extractWikilinks(body: string): string[] {
  const masked = body.replace(FENCE_RE, "").replace(INLINE_CODE_RE, "")
  const out: string[] = []
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const slug = m[1].trim()
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}
```

`bundle.ts`:

```ts
import type { VaultStorage } from "./storage"
import type { WikiPage } from "./types"
import { parseDocument } from "./frontmatter"
import { extractWikilinks } from "./wikilinks"

export interface Bundle {
  pages: Map<string, WikiPage>
  links: Array<{ from: string; to: string }>
  errors: Array<{ path: string; message: string }>
}

export async function loadBundle(storage: VaultStorage): Promise<Bundle> {
  const pages = new Map<string, WikiPage>()
  const errors: Bundle["errors"] = []

  for (const path of await storage.list("wiki/")) {
    if (!path.endsWith(".md")) continue
    const raw = await storage.read(path)
    if (raw === null) continue
    try {
      const { frontmatter, body } = parseDocument(raw)
      const id = path.slice(0, -3)
      pages.set(id, { id, path, frontmatter, body })
    } catch (e) {
      errors.push({ path, message: (e as Error).message })
    }
  }

  const bundle: Bundle = { pages, links: [], errors }
  for (const page of pages.values()) {
    for (const slug of extractWikilinks(page.body)) {
      const target = resolveLink(bundle, slug)
      if (target) bundle.links.push({ from: page.id, to: target.id })
    }
  }
  return bundle
}

export function resolveLink(bundle: Bundle, slug: string): WikiPage | null {
  for (const page of bundle.pages.values()) {
    if (page.id.split("/").pop() === slug) return page
  }
  return null
}

export function backlinks(bundle: Bundle, id: string): string[] {
  return bundle.links.filter((l) => l.to === id).map((l) => l.from).sort()
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/wikilinks.test.ts src/lib/vault/__tests__/bundle.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/wikilinks.ts src/lib/vault/bundle.ts src/lib/vault/__tests__/wikilinks.test.ts src/lib/vault/__tests__/bundle.test.ts
git commit -m "feat(vault): wikilink extraction and bundle loader with derived link edges"
```

---

### Task 8: Atomic changesets with revert

**Files:**
- Create: `src/lib/vault/changesets.ts`
- Test: `src/lib/vault/__tests__/changesets.test.ts`

**Interfaces:**
- Consumes: `VaultStorage`, `Changeset`, `FileChange`
- Produces:
  - `makeChangesetId(): string` — `cs-<epochms>-<4 hex>`
  - `applyChangeset(storage: VaultStorage, cs: Changeset): Promise<void>` — verifies every `change.before` matches current content (conflict detection) BEFORE writing anything; throws `ChangesetConflictError` listing conflicting paths; then applies all changes; also persists the changeset JSON to `.scispark/changesets/<id>.json`
  - `revertChangeset(storage: VaultStorage, cs: Changeset): Promise<void>` — restores every `before` (deletes files whose `before` is null)
  - `loadChangeset(storage: VaultStorage, id: string): Promise<Changeset | null>`

- [ ] **Step 1: Write the failing test `src/lib/vault/__tests__/changesets.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { applyChangeset, revertChangeset, loadChangeset, ChangesetConflictError } from "../changesets"
import type { Changeset } from "../types"

const cs = (changes: Changeset["changes"]): Changeset => ({
  id: "cs-1-abcd", skill: "ingest", model: "test-model",
  timestamp: "2026-07-11T00:00:00Z", changes,
})

describe("applyChangeset", () => {
  it("applies create + modify atomically and persists the record", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", "old")
    await applyChangeset(s, cs([
      { path: "wiki/concepts/a.md", before: "old", after: "new" },
      { path: "wiki/methods/b.md", before: null, after: "created" },
    ]))
    expect(await s.read("wiki/concepts/a.md")).toBe("new")
    expect(await s.read("wiki/methods/b.md")).toBe("created")
    expect(await loadChangeset(s, "cs-1-abcd")).not.toBeNull()
  })

  it("rejects the WHOLE changeset on any before-mismatch, writing nothing", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", "actually-different")
    await expect(applyChangeset(s, cs([
      { path: "wiki/concepts/a.md", before: "old", after: "new" },
      { path: "wiki/methods/b.md", before: null, after: "created" },
    ]))).rejects.toThrow(ChangesetConflictError)
    expect(await s.read("wiki/concepts/a.md")).toBe("actually-different")
    expect(await s.read("wiki/methods/b.md")).toBeNull()
  })
})

describe("revertChangeset", () => {
  it("restores before-states, deleting created files", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/a.md", "old")
    const c = cs([
      { path: "wiki/concepts/a.md", before: "old", after: "new" },
      { path: "wiki/methods/b.md", before: null, after: "created" },
    ])
    await applyChangeset(s, c)
    await revertChangeset(s, c)
    expect(await s.read("wiki/concepts/a.md")).toBe("old")
    expect(await s.read("wiki/methods/b.md")).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/changesets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/vault/changesets.ts`**

```ts
import type { VaultStorage } from "./storage"
import type { Changeset } from "./types"

export class ChangesetConflictError extends Error {
  constructor(public conflicts: string[]) {
    super(`changeset conflicts at: ${conflicts.join(", ")}`)
  }
}

export function makeChangesetId(): string {
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")
  return `cs-${Date.now()}-${hex}`
}

export async function applyChangeset(storage: VaultStorage, cs: Changeset): Promise<void> {
  const conflicts: string[] = []
  for (const ch of cs.changes) {
    const current = await storage.read(ch.path)
    if (current !== ch.before) conflicts.push(ch.path)
  }
  if (conflicts.length) throw new ChangesetConflictError(conflicts)

  for (const ch of cs.changes) {
    if (ch.after === null) await storage.delete(ch.path)
    else await storage.write(ch.path, ch.after)
  }
  await storage.write(`.scispark/changesets/${cs.id}.json`, JSON.stringify(cs, null, 2))
}

export async function revertChangeset(storage: VaultStorage, cs: Changeset): Promise<void> {
  for (const ch of cs.changes) {
    if (ch.before === null) await storage.delete(ch.path)
    else await storage.write(ch.path, ch.before)
  }
}

export async function loadChangeset(storage: VaultStorage, id: string): Promise<Changeset | null> {
  const raw = await storage.read(`.scispark/changesets/${id}.json`)
  return raw ? (JSON.parse(raw) as Changeset) : null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/changesets.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/changesets.ts src/lib/vault/__tests__/changesets.test.ts
git commit -m "feat(vault): atomic changesets with conflict detection and revert"
```

---

### Task 9: Index builder + log appender

**Files:**
- Create: `src/lib/vault/index-builder.ts`
- Test: `src/lib/vault/__tests__/index-builder.test.ts`

**Interfaces:**
- Consumes: `Bundle` (Task 7), `VaultStorage`
- Produces:
  - `buildIndexMarkdown(bundle: Bundle): string` — deterministic `index.md`: one `## <Type>` section per page type present (plural heading, alphabetical), one line per page: `- [[<slug>]] — <title>` sorted by title
  - `writeIndex(storage: VaultStorage, bundle: Bundle): Promise<void>`
  - `appendLog(storage: VaultStorage, entry: { date: string; op: string; summary: string }): Promise<void>` — appends `## [<date>] <op> | <summary>` to `log.md` (creates the file with a `# Log` header if missing)

- [ ] **Step 1: Write the failing test `src/lib/vault/__tests__/index-builder.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { serializeDocument } from "../frontmatter"
import { loadBundle } from "../bundle"
import { buildIndexMarkdown, writeIndex, appendLog } from "../index-builder"
import type { Frontmatter } from "../types"

const fm = (type: string, title: string): Frontmatter => ({
  type, title, created: "2026-07-11", updated: "2026-07-11",
  tags: [], related: [], sources: ["s.pdf"],
})

describe("index + log", () => {
  it("builds a deterministic index grouped by type", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/b-concept.md", serializeDocument(fm("concept", "B Concept"), "x"))
    await s.write("wiki/concepts/a-concept.md", serializeDocument(fm("concept", "A Concept"), "x"))
    await s.write("wiki/papers/p1.md", serializeDocument(fm("paper", "Paper One"), "x"))
    const idx = buildIndexMarkdown(await loadBundle(s))
    expect(idx).toContain("## Concepts")
    expect(idx).toContain("## Papers")
    expect(idx.indexOf("A Concept")).toBeLessThan(idx.indexOf("B Concept"))
    expect(idx).toContain("- [[p1]] — Paper One")
    await writeIndex(s, await loadBundle(s))
    expect(await s.read("index.md")).toBe(idx)
  })

  it("appends log entries, creating log.md on first use", async () => {
    const s = new MemoryVaultStorage()
    await appendLog(s, { date: "2026-07-11", op: "ingest", summary: "Paper One" })
    await appendLog(s, { date: "2026-07-12", op: "lint", summary: "fixed links" })
    const log = (await s.read("log.md")) as string
    expect(log.startsWith("# Log")).toBe(true)
    expect(log).toContain("## [2026-07-11] ingest | Paper One")
    expect(log.indexOf("2026-07-11")).toBeLessThan(log.indexOf("2026-07-12"))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/index-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/vault/index-builder.ts`**

```ts
import type { VaultStorage } from "./storage"
import type { Bundle } from "./bundle"

const TYPE_HEADINGS: Record<string, string> = {
  paper: "Papers", concept: "Concepts", method: "Methods", finding: "Findings",
  comparison: "Comparisons", author: "Authors", topic: "Topics", note: "Notes",
  idea: "Ideas", project: "Projects",
}

export function buildIndexMarkdown(bundle: Bundle): string {
  const byType = new Map<string, Array<{ slug: string; title: string }>>()
  for (const page of bundle.pages.values()) {
    const slug = page.id.split("/").pop() as string
    const rows = byType.get(page.frontmatter.type) ?? []
    rows.push({ slug, title: page.frontmatter.title })
    byType.set(page.frontmatter.type, rows)
  }
  const sections = [...byType.keys()].sort().map((type) => {
    const heading = TYPE_HEADINGS[type] ?? type
    const rows = (byType.get(type) as Array<{ slug: string; title: string }>)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => `- [[${r.slug}]] — ${r.title}`)
    return `## ${heading}\n\n${rows.join("\n")}`
  })
  return `# Index\n\n${sections.join("\n\n")}\n`
}

export async function writeIndex(storage: VaultStorage, bundle: Bundle): Promise<void> {
  await storage.write("index.md", buildIndexMarkdown(bundle))
}

export async function appendLog(
  storage: VaultStorage,
  entry: { date: string; op: string; summary: string },
): Promise<void> {
  const existing = (await storage.read("log.md")) ?? "# Log\n"
  const line = `\n## [${entry.date}] ${entry.op} | ${entry.summary}\n`
  await storage.write("log.md", existing.trimEnd() + "\n" + line.trimStart())
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/index-builder.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/index-builder.ts src/lib/vault/__tests__/index-builder.test.ts
git commit -m "feat(vault): deterministic index builder and log appender"
```

---

### Task 10: Vault scaffold (new-vault initialization)

**Files:**
- Create: `src/lib/vault/scaffold.ts`
- Test: `src/lib/vault/__tests__/scaffold.test.ts`

**Interfaces:**
- Consumes: `VaultStorage`, `writeIndex`/`loadBundle`
- Produces: `createVault(storage: VaultStorage, opts: { purpose: string; today: string }): Promise<void>` — idempotent (throws `VaultExistsError` if `schema.md` already present); writes `purpose.md`, `schema.md` (full Page Types table for all 10 types), empty `index.md`, `log.md` with a created entry

- [ ] **Step 1: Write the failing test `src/lib/vault/__tests__/scaffold.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { createVault, VaultExistsError } from "../scaffold"

describe("createVault", () => {
  it("writes the four reserved files with the schema table", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "Track TRD neuromodulation research.", today: "2026-07-11" })
    const schema = (await s.read("schema.md")) as string
    expect(schema).toContain("## Page Types")
    for (const row of ["| paper | wiki/papers |", "| idea | wiki/ideas |", "| project | wiki/projects |"]) {
      expect(schema).toContain(row)
    }
    expect(await s.read("purpose.md")).toContain("Track TRD neuromodulation research.")
    expect(await s.read("index.md")).toContain("# Index")
    expect(await s.read("log.md")).toContain("## [2026-07-11] init | vault created")
  })

  it("refuses to scaffold over an existing vault", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "p", today: "2026-07-11" })
    await expect(createVault(s, { purpose: "p", today: "2026-07-11" })).rejects.toThrow(VaultExistsError)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/scaffold.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/vault/scaffold.ts`**

```ts
import type { VaultStorage } from "./storage"
import { PAGE_TYPES } from "./types"
import { appendLog } from "./index-builder"

export class VaultExistsError extends Error {}

const TYPE_DIRS: Record<string, string> = {
  paper: "wiki/papers", concept: "wiki/concepts", method: "wiki/methods",
  finding: "wiki/findings", comparison: "wiki/comparisons", author: "wiki/authors",
  topic: "wiki/topics", note: "wiki/notes", idea: "wiki/ideas", project: "wiki/projects",
}

export async function createVault(
  storage: VaultStorage,
  opts: { purpose: string; today: string },
): Promise<void> {
  if ((await storage.read("schema.md")) !== null) throw new VaultExistsError("vault already initialized")

  const rows = PAGE_TYPES.map((t) => `| ${t} | ${TYPE_DIRS[t]} |`).join("\n")
  await storage.write(
    "schema.md",
    `# Vault Schema

## Page Types

| type | directory |
|---|---|
${rows}

## Frontmatter contract

Every page requires: \`type\`, \`title\`, \`created\`, \`updated\`, \`tags\` (array), \`related\` (array of bare slugs), \`sources\` (array of source identifiers). Wikilinks (\`[[slug]]\`) belong in the body only. \`index.md\` and \`log.md\` are maintained by the application — never edit them by hand or by model output.
`,
  )
  await storage.write("purpose.md", `# Purpose\n\n${opts.purpose}\n`)
  await storage.write("index.md", "# Index\n")
  await appendLog(storage, { date: opts.today, op: "init", summary: "vault created" })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/scaffold.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/scaffold.ts src/lib/vault/__tests__/scaffold.test.ts
git commit -m "feat(vault): vault scaffolding with schema.md page-type routing table"
```

---

### Task 11: Zip export / import

**Files:**
- Create: `src/lib/vault/export.ts`
- Test: `src/lib/vault/__tests__/export.test.ts`

**Interfaces:**
- Consumes: `VaultStorage`; `fflate` (`zipSync`, `unzipSync`, `strToU8`, `strFromU8`)
- Produces:
  - `exportVaultZip(storage: VaultStorage): Promise<Uint8Array>` — zips every file in the vault
  - `importVaultZip(storage: VaultStorage, data: Uint8Array): Promise<{ files: number }>` — writes every zip entry into storage (overwrite semantics)

- [ ] **Step 1: Write the failing test `src/lib/vault/__tests__/export.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { exportVaultZip, importVaultZip } from "../export"

describe("vault zip round-trip", () => {
  it("export → import reproduces every file", async () => {
    const src = new MemoryVaultStorage()
    await src.write("purpose.md", "# Purpose\np\n")
    await src.write("wiki/concepts/a.md", "---\n...")
    await src.write(".scispark/changesets/cs-1-abcd.json", "{}")

    const zip = await exportVaultZip(src)
    const dst = new MemoryVaultStorage()
    const { files } = await importVaultZip(dst, zip)

    expect(files).toBe(3)
    expect(dst.snapshot()).toEqual(src.snapshot())
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/vault/__tests__/export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/vault/export.ts`**

```ts
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate"
import type { VaultStorage } from "./storage"

export async function exportVaultZip(storage: VaultStorage): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {}
  for (const path of await storage.list()) {
    const content = await storage.read(path)
    if (content !== null) entries[path] = strToU8(content)
  }
  return zipSync(entries)
}

export async function importVaultZip(
  storage: VaultStorage,
  data: Uint8Array,
): Promise<{ files: number }> {
  const entries = unzipSync(data)
  let files = 0
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith("/")) continue // directory entries
    await storage.write(path, strFromU8(bytes))
    files++
  }
  return { files }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/vault/__tests__/export.test.ts`
Expected: 1 PASS. Then run the full suite: `npm test` — expected: all vault tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/export.ts src/lib/vault/__tests__/export.test.ts
git commit -m "feat(vault): zip export/import round-trip"
```

---

### Task 12: In-app vault wiring + OPFS debug page

**Files:**
- Create: `src/lib/vault/get-vault.ts`, `src/app/debug/vault/page.tsx`

**Interfaces:**
- Consumes: everything above
- Produces: `getVault(): Promise<VaultStorage>` — module-level singleton; OPFS in the browser, memory otherwise (SSR safety). A `/debug/vault` page that (a) scaffolds a vault on first visit, (b) lists files, (c) runs a browser-side self-test equivalent to the Task 5 contract, (d) offers an "Export zip" download. This is the manual verification gate for OPFS.

- [ ] **Step 1: Implement `src/lib/vault/get-vault.ts`**

```ts
import type { VaultStorage } from "./storage"
import { MemoryVaultStorage } from "./memory-storage"
import { OpfsVaultStorage } from "./opfs-storage"

let vaultPromise: Promise<VaultStorage> | null = null

export function getVault(): Promise<VaultStorage> {
  if (!vaultPromise) {
    vaultPromise =
      typeof navigator !== "undefined" && navigator.storage?.getDirectory
        ? OpfsVaultStorage.create()
        : Promise.resolve(new MemoryVaultStorage())
  }
  return vaultPromise
}
```

- [ ] **Step 2: Implement `src/app/debug/vault/page.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { getVault } from "@/lib/vault/get-vault"
import { createVault, VaultExistsError } from "@/lib/vault/scaffold"
import { exportVaultZip } from "@/lib/vault/export"

export default function VaultDebugPage() {
  const [files, setFiles] = useState<string[]>([])
  const [selfTest, setSelfTest] = useState("running…")

  useEffect(() => {
    ;(async () => {
      const vault = await getVault()
      try {
        await createVault(vault, { purpose: "Debug vault.", today: new Date().toISOString().slice(0, 10) })
      } catch (e) {
        if (!(e instanceof VaultExistsError)) throw e
      }
      // contract self-test (mirrors storage-contract.ts assertions)
      const probe = `debug/probe-${Date.now()}.md`
      const results: string[] = []
      results.push((await vault.read("debug/missing.md")) === null ? "read-missing ok" : "read-missing FAIL")
      await vault.write(probe, "hello")
      results.push((await vault.read(probe)) === "hello" ? "write-read ok" : "write-read FAIL")
      await vault.delete(probe)
      results.push((await vault.read(probe)) === null ? "delete ok" : "delete FAIL")
      setSelfTest(results.join(" · "))
      setFiles(await vault.list())
    })()
  }, [])

  const download = async () => {
    const vault = await getVault()
    const zip = await exportVaultZip(vault)
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }))
    const a = Object.assign(document.createElement("a"), { href: url, download: "scispark-vault.zip" })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>Vault debug</h1>
      <p>Self-test: {selfTest}</p>
      <button onClick={download}>Export zip</button>
      <ul>{files.map((f) => <li key={f}>{f}</li>)}</ul>
    </div>
  )
}
```

- [ ] **Step 3: Verify in the browser (the OPFS gate)**

```bash
npm run dev -- --port 3100
```

Open `http://localhost:3100/debug/vault`. Expected: self-test line reads `read-missing ok · write-read ok · delete ok`; file list shows `index.md`, `log.md`, `purpose.md`, `schema.md`; reloading the page keeps the same files (OPFS persistence); "Export zip" downloads a zip containing them.

- [ ] **Step 4: Full check**

```bash
npm test && npx tsc --noEmit
```

Expected: all tests pass, types clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault/get-vault.ts src/app/debug/vault/page.tsx
git commit -m "feat(vault): app wiring with OPFS singleton and /debug/vault verification page"
```

---

## Self-Review Notes

- **Spec coverage (M1 slice):** vault layout ✓ (scaffold + type dirs), frontmatter contract ✓ (Task 4 strict parser), path-as-id + wikilinks→edges ✓ (Task 7), changesets/undo ✓ (Task 8), app-owned index/log ✓ (Task 9), OPFS + storage abstraction ✓ (Tasks 5/6/12), zip export ✓ (Task 11), fork + branding ✓ (Tasks 1–2). Deliberately deferred per roadmap: FSA folder storage (M11), binary storage for PDFs (M6), schema.md *parsing* for routing validation (M4, where ingest needs it).
- **Type consistency:** `Frontmatter`/`WikiPage`/`Changeset` defined once in Task 4 and imported everywhere; `storageContractTests` signature matches usage in Tasks 5 and 12's mirrored self-test.
- **Known risk:** the fork's Next.js 16 specifics (Task 1/2/12 only) — implementer must read the fork's `AGENTS.md` before touching app code; vault library tasks are framework-free.
