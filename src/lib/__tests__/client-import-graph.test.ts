import { existsSync, readFileSync, readdirSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const ROOT = resolve("src")
const NODE_MODULES = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const SERVER_MODULES = new Set([
  "lib/skills/runner.ts",
  "lib/skills/feed.ts",
  "lib/skills/digest.ts",
  "lib/trending/dashboard.ts",
])

/** Follow runtime edges, not erased TypeScript contracts. */
function runtimeImports(source: ts.SourceFile): string[] {
  const imports: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      if (!clause || (!clause.isTypeOnly && (
        clause.name || !bindings || ts.isNamespaceImport(bindings)
        || bindings.elements.length === 0 || bindings.elements.some((item) => !item.isTypeOnly)
      ))) imports.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      if (!node.isTypeOnly && (!clause || ts.isNamespaceExport(clause)
        || clause.elements.length === 0 || clause.elements.some((item) => !item.isTypeOnly))) {
        imports.push(node.moduleSpecifier.text)
      }
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      const specifier = node.arguments[0]
      if (specifier && ts.isStringLiteralLike(specifier)) imports.push(specifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

function* files(dir: string): Generator<string> {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name === "__tests__") continue
    const path = join(dir, item.name)
    if (item.isDirectory()) yield* files(path)
    else if (/\.tsx?$/.test(item.name)) yield path
  }
}

function localModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? resolve(ROOT, specifier.slice(2))
    : specifier.startsWith(".") ? resolve(dirname(from), specifier) : null
  if (!base) return null
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]
    .find((path) => /\.tsx?$/.test(path) && existsSync(path)) ?? null
}

describe("client runtime import graph", () => {
  it("distinguishes runtime imports/re-exports from erased types", () => {
    const source = ts.createSourceFile("test.ts", `
      import type { A } from "./types-only";
      import { type B } from "./inline-types-only";
      export type { C } from "./export-types-only";
      export { type D } from "./inline-export-types-only";
      import { type E, load } from "./mixed";
      export { load } from "./barrel";
      import "./side-effect";
      import {} from "./empty";
      import * as namespace from "./namespace";
      const deferred = import(\`./dynamic\`);
      const common = require("./common");
    `, ts.ScriptTarget.Latest, true)
    expect(runtimeImports(source)).toEqual(["./mixed", "./barrel", "./side-effect", "./empty", "./namespace", "./dynamic", "./common"])
  })

  it("no client entry reaches server orchestration, providers, or Node builtins through intermediate helpers", () => {
    const sources = new Map<string, ts.SourceFile>()
    const read = (file: string) => {
      if (!sources.has(file)) sources.set(file, ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true))
      return sources.get(file)!
    }
    const roots = [...files(ROOT)].filter((file) => read(file).statements.some((node) =>
      ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === "use client",
    ))
    expect(roots.length).toBeGreaterThan(0)
    const visited = new Set<string>()
    const violations: string[] = []
    const visit = (file: string, chain: string[]) => {
      if (visited.has(file)) return
      visited.add(file)
      for (const specifier of runtimeImports(read(file))) {
        if (NODE_MODULES.has(specifier) || specifier === "server-only" || specifier.startsWith("@anthropic-ai/sdk")) {
          violations.push([...chain, specifier].join(" -> "))
          continue
        }
        const target = localModule(file, specifier)
        if (!target) continue
        const path = relative(ROOT, target)
        const next = [...chain, path]
        if (SERVER_MODULES.has(path) || path.startsWith("lib/llm/providers/")) {
          violations.push(next.join(" -> "))
        } else visit(target, next)
      }
    }
    for (const root of roots) visit(root, [relative(ROOT, root)])
    expect(violations, violations.join("\n")).toEqual([])
  })
})
