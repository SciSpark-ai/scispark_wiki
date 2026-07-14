import { describe, it, expect, afterEach } from "vitest"
import { readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Browser-purity gate (M11 Task 10 — local-runtime pivot, final enforcement
 * step): client code (everything under `src/app` and `src/components`,
 * EXCLUDING `src/app/api/**`, which is server route-handler code and may
 * import anything) must never run a skill, apply/revert a vault changeset,
 * load/save LLM settings, or touch a provider implementation directly. All
 * of that moved server-side across M11 Tasks 1-9 (every real client surface
 * now talks to `/api/vault`, `/api/settings`, or `/api/skills/*`); this test
 * makes that constraint permanent so a future PR can't silently reintroduce
 * a direct `runSkill`/`loadSettings`/provider import in a page or component.
 *
 * Approach: statically parse `import`/`export ... from` statements (plus
 * dynamic `import(...)` and side-effect-only `import "mod"`) out of each
 * file's source text and check the imported module + bindings against a
 * banned list. `import type { ... }` (whole-statement or per-specifier) is
 * erased at compile time and always allowed — it can't run code or leak a
 * key. Comments are stripped first so prose mentioning a banned module path
 * (e.g. this file's own header, or an inline note like the one in
 * `src/app/debug/llm/page.tsx`) never triggers a false positive.
 *
 * Two ban shapes:
 *  - "whole module": ANY value import (default/named/namespace/dynamic/
 *    side-effect) from the module is banned. Used for modules whose only
 *    real client-relevant export IS the banned function (e.g.
 *    `lib/skills/runner` exports nothing but `runSkill`), or where nothing
 *    client-side legitimately needs the module at all.
 *  - "named": only specific exported bindings are banned; other exports
 *    (types, pure helpers, constants) from the same module are fine and
 *    already used client-side today (e.g. `lib/skills/feed` exports
 *    `loadFeed`/`FeedResult`/`FEED_CACHE_PATH` for the feed page, but
 *    `runFeed` — the LLM-calling orchestrator — must stay server-only).
 */

const ROOTS = ["src/app", "src/components"]
const EXCLUDED_PREFIX = join("src", "app", "api")
const FILE_EXTENSIONS = new Set([".ts", ".tsx"])

/**
 * Second scan set (M11 Task 10 final-review fix — gate blind spot): the main
 * `ROOTS` walk above only covers `src/app`/`src/components`, but several
 * `src/lib/**` helper modules are themselves imported directly by client
 * code (pages/components import `*-client.ts` wrappers that call
 * `/api/vault`, `/api/settings`, `/api/skills/*` instead of running skills
 * or touching providers locally). Those modules need the same purity
 * guarantee, but scanning all of `src/lib` would be wrong — most of it is
 * server/shared orchestration code (skill runners, provider implementations,
 * changeset appliers) that legitimately imports the very things this gate
 * bans. So this is a hand-picked allowlist of the known browser-imported
 * `lib` helpers, not a directory walk. If a new client-facing `lib` helper
 * is added, add its path here.
 */
const CLIENT_LIB_FILES = [
  join("src", "lib", "trending", "client.ts"),
  join("src", "lib", "spark", "client.ts"),
  join("src", "lib", "skills", "feed-client.ts"),
  join("src", "lib", "skills", "ingest-client.ts"),
  join("src", "lib", "companion", "client.ts"),
  join("src", "lib", "reader", "client.ts"),
  join("src", "lib", "llm", "settings-client.ts"),
  join("src", "lib", "vault", "changeset-client.ts"),
  join("src", "lib", "vault", "remote-storage.ts"),
  join("src", "lib", "server", "ndjson.ts"),
]

const WHOLE_MODULE_BANS = new Set([
  "lib/skills/runner",
  "lib/spark/quick",
  "lib/spark/deep",
  "lib/trending/auto-refresh",
  "lib/skills/consolidation",
  "lib/companion/run",
])
const PROVIDERS_PREFIX = "lib/llm/providers"

const NAMED_BANS: Record<string, string[]> = {
  "lib/trending/dashboard": ["runTrendingDashboard"],
  "lib/skills/feed": ["runFeed"],
  "lib/skills/digest": ["generateDigest"],
  "lib/vault/changesets": ["applyChangeset", "revertChangeset"],
  "lib/llm/settings": ["loadSettings", "saveSettings"],
}

interface Violation {
  file: string
  statement: string
  reason: string
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue
      if (full === EXCLUDED_PREFIX || full.startsWith(EXCLUDED_PREFIX + "/")) continue
      yield* walk(full)
    } else {
      const dot = entry.lastIndexOf(".")
      if (dot !== -1 && FILE_EXTENSIONS.has(entry.slice(dot))) yield full
    }
  }
}

/**
 * Strips block and line comments so prose mentioning a banned module path
 * never trips the gate — WITHOUT stripping `//` that appears inside a string
 * literal. A naive `/\/\/.*$/gm` regex deletes everything after the FIRST
 * `//` on a line unconditionally, so e.g.
 * `const U = "https://x"; import{runSkill}from"@/lib/skills/runner"` would
 * have the real import erased before the scanner ever sees it (the `//` in
 * the URL string looks identical to a line-comment start to a regex that
 * isn't tracking string state). This is a small hand-rolled tokenizer that
 * tracks whether it's inside a single/double/template-quoted string and only
 * treats `//`/`/* *\/` as comment delimiters when they're NOT inside one.
 */
function stripComments(src: string): string {
  let out = ""
  let i = 0
  const n = src.length
  let inString: '"' | "'" | "`" | null = null

  while (i < n) {
    const c = src[i]
    const c2 = i + 1 < n ? src[i + 1] : ""

    if (inString) {
      if (c === "\\" && i + 1 < n) {
        out += c + src[i + 1]
        i += 2
        continue
      }
      out += c
      if (c === inString) inString = null
      i++
      continue
    }

    if (c === '"' || c === "'" || c === "`") {
      inString = c
      out += c
      i++
      continue
    }

    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++
      continue // leave the newline itself for the next iteration to copy through
    }

    if (c === "/" && c2 === "*") {
      i += 2
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++
      i = Math.min(i + 2, n) // skip past the closing "*/" (or clamp at EOF for an unterminated block comment)
      continue
    }

    out += c
    i++
  }

  return out
}

/** Only internal `lib/...` modules are relevant (npm packages, `next/...`, `@/components/...` etc. are never banned). Handles both the `@/lib/...` alias and relative paths that traverse into `lib/`. */
function normalizeModulePath(spec: string): string | null {
  const m = spec.match(/(?:^|\/)lib\/(.+)$/)
  return m ? `lib/${m[1]}` : null
}

interface ImportClause {
  hasNamespace: boolean
  hasDefault: boolean
  named: { name: string; isType: boolean }[]
}

/** Parses the clause between `import`/`export` and `from` — e.g. `Foo, { a, type b, c as d }` or `* as ns`. */
function parseClause(clauseText: string): ImportClause {
  let hasNamespace = false
  let hasDefault = false
  const named: { name: string; isType: boolean }[] = []

  const braceMatch = clauseText.match(/\{([^}]*)\}/)
  let rest = clauseText
  if (braceMatch) {
    rest = clauseText.slice(0, braceMatch.index) + clauseText.slice(braceMatch.index! + braceMatch[0].length)
    const inner = braceMatch[1].trim()
    if (inner.length > 0) {
      for (const rawItem of inner.split(",")) {
        const item = rawItem.trim()
        if (!item) continue
        const isType = /^type\s+/.test(item)
        const withoutType = item.replace(/^type\s+/, "")
        const name = withoutType.split(/\s+as\s+/)[0].trim()
        if (name) named.push({ name, isType })
      }
    }
  }
  // What's left after removing the `{ ... }` section is zero or more of a
  // default-import identifier and/or a `* as ns` namespace clause, e.g.
  // "Foo", "* as ns", or "Foo, * as ns".
  for (const part of rest.trim().split(",").map((p) => p.trim()).filter(Boolean)) {
    if (part.startsWith("*")) hasNamespace = true
    else hasDefault = true
  }
  return { hasNamespace, hasDefault, named }
}

function checkAnyAccess(moduleSpec: string, statement: string, file: string, violations: Violation[]): void {
  const normalized = normalizeModulePath(moduleSpec)
  if (!normalized) return
  if (WHOLE_MODULE_BANS.has(normalized) || normalized.startsWith(PROVIDERS_PREFIX) || NAMED_BANS[normalized]) {
    violations.push({
      file,
      statement: statement.trim(),
      reason: `wildcard/dynamic import exposes banned bindings from "${normalized}"`,
    })
  }
}

function checkWholeOnly(moduleSpec: string, statement: string, file: string, violations: Violation[]): void {
  const normalized = normalizeModulePath(moduleSpec)
  if (!normalized) return
  if (WHOLE_MODULE_BANS.has(normalized) || normalized.startsWith(PROVIDERS_PREFIX)) {
    violations.push({
      file,
      statement: statement.trim(),
      reason: `side-effect import of whole-module-banned "${normalized}"`,
    })
  }
}

function scanFile(file: string): Violation[] {
  const violations: Violation[] = []
  const cleaned = stripComments(readFileSync(file, "utf-8"))

  // Dynamic import("mod") — resolves to the full module namespace object.
  // The quote class includes backtick so a no-substitution template-literal
  // specifier — `import(\`@/lib/skills/runner\`)` — can't evade the scan just
  // by swapping quote style; template literals are otherwise lexically
  // interchangeable with string literals for a static specifier.
  for (const m of cleaned.matchAll(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    checkAnyAccess(m[1], m[0], file, violations)
  }

  // CommonJS require("mod") — same "whole module or any binding is a risk"
  // treatment as dynamic import(), since a require() may be destructured and
  // it's not worth statically tracing every extraction. Backtick included for
  // the same reason as dynamic import() above.
  for (const m of cleaned.matchAll(/\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    checkAnyAccess(m[1], m[0], file, violations)
  }

  // Side-effect-only: import "mod"; (no bindings, so only whole-module bans apply).
  // Whitespace between `import` and the string is optional — `import"mod"` is
  // valid JS (a keyword directly followed by a string literal needs no
  // separating whitespace), and is exactly the shape a minifier emits.
  for (const m of cleaned.matchAll(/\bimport\s*["']([^"']+)["']\s*;?/g)) {
    checkWholeOnly(m[1], m[0], file, violations)
  }

  // Static `import ... from "mod"` / `export ... from "mod"` (covers `export *`/`export * as ns` too,
  // since their clause text is `*`/`* as ns`, which parseClause reports as a namespace import).
  //
  // Whitespace around the clause is optional to match what a minifier
  // produces: `import{runSkill}from"@/lib/skills/runner"` is valid JS (no
  // separating whitespace is lexically required around `{`/`}`/a string
  // literal) and must not evade this scan just because it lacks the spacing
  // Prettier would normally add. `(?=[\s{*])` after `import`/`export` still
  // guards against matching a plain identifier prefix like "importantly" —
  // the character right after the keyword must be whitespace, `{`, or `*`.
  for (const m of cleaned.matchAll(/\b(import|export)(?=[\s{*])\s*(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g)) {
    const [full, , typeOnlyStmt, clauseText, moduleSpec] = m
    if (typeOnlyStmt) continue // `import type {...} from "..."` / `export type {...} from "..."` — erased at compile time

    const normalized = normalizeModulePath(moduleSpec)
    if (!normalized) continue

    const clause = parseClause(clauseText)
    if (clause.hasNamespace) {
      checkAnyAccess(moduleSpec, full, file, violations)
      continue
    }

    if (WHOLE_MODULE_BANS.has(normalized) || normalized.startsWith(PROVIDERS_PREFIX)) {
      const hasValueImport = clause.hasDefault || clause.named.some((n) => !n.isType)
      if (hasValueImport) {
        violations.push({
          file,
          statement: full.trim(),
          reason: `whole-module-banned import from "${normalized}"`,
        })
      }
      continue
    }

    const bannedNames = NAMED_BANS[normalized]
    if (bannedNames) {
      for (const hit of clause.named.filter((n) => !n.isType && bannedNames.includes(n.name))) {
        violations.push({
          file,
          statement: full.trim(),
          reason: `banned import "${hit.name}" from "${normalized}"`,
        })
      }
    }
  }

  return violations
}

describe("browser purity", () => {
  it("client code (src/app excluding src/app/api, src/components) never imports skill-running, changeset-applying, settings-loading, or provider code", () => {
    const violations: Violation[] = []
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        violations.push(...scanFile(file))
      }
    }
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}: ${v.reason}\n    ${v.statement}`).join("\n")
      expect.fail(`Found ${violations.length} browser-purity violation(s):\n${report}`)
    }
  })

  it("known browser-imported src/lib client-helper modules never import skill-running, changeset-applying, settings-loading, or provider code", () => {
    const violations: Violation[] = []
    for (const file of CLIENT_LIB_FILES) {
      if (!existsSync(file)) {
        throw new Error(`browser-purity CLIENT_LIB_FILES allowlist entry is missing on disk: ${file}`)
      }
      violations.push(...scanFile(file))
    }
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}: ${v.reason}\n    ${v.statement}`).join("\n")
      expect.fail(`Found ${violations.length} browser-purity violation(s) in client-lib helpers:\n${report}`)
    }
  })

  // Re-review finding: a no-substitution template-literal specifier —
  // `await import(\`@/lib/skills/runner\`)` or `require(\`@/lib/skills/runner\`)`
  // — is lexically just as static as a quoted string but used a different
  // quote char, so the original `["']`-only regexes silently let it through.
  // These write a real throwaway file under a scanned root (so the walk/read
  // path is exercised end-to-end, not just the regex in isolation), assert
  // the scanner now catches it, then delete the file regardless of outcome.
  describe("backtick-quoted dynamic import()/require() specifiers are caught", () => {
    const scratchFile = join("src", "app", "__purity_scratch_backtick_test.ts")

    afterEach(() => {
      if (existsSync(scratchFile)) rmSync(scratchFile)
    })

    it("backtick import(`@/lib/skills/runner`) is flagged", () => {
      writeFileSync(
        scratchFile,
        "export async function evade() {\n  const mod = await import(`@/lib/skills/runner`)\n  return mod\n}\n",
        "utf-8",
      )
      const violations = scanFile(scratchFile)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.reason.includes("lib/skills/runner"))).toBe(true)
    })

    it("backtick require(`@/lib/skills/runner`) is flagged", () => {
      writeFileSync(
        scratchFile,
        "export function evade() {\n  const mod = require(`@/lib/skills/runner`)\n  return mod\n}\n",
        "utf-8",
      )
      const violations = scanFile(scratchFile)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.reason.includes("lib/skills/runner"))).toBe(true)
    })
  })
})
