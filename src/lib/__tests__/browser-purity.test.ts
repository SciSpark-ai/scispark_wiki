import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
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

/** Strips block and line comments so prose mentioning a banned module path never trips the gate. */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "")
  return noBlock.replace(/\/\/.*$/gm, "")
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
  for (const m of cleaned.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    checkAnyAccess(m[1], m[0], file, violations)
  }

  // Side-effect-only: import "mod"; (no bindings, so only whole-module bans apply)
  for (const m of cleaned.matchAll(/\bimport\s+["']([^"']+)["']\s*;?/g)) {
    checkWholeOnly(m[1], m[0], file, violations)
  }

  // Static `import ... from "mod"` / `export ... from "mod"` (covers `export *`/`export * as ns` too,
  // since their clause text is `*`/`* as ns`, which parseClause reports as a namespace import).
  for (const m of cleaned.matchAll(/\b(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
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
})
