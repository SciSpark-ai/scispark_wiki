import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(process.cwd(), "src/components")
// Canvas/WebGL renderers can't read CSS variables — literals allowed there.
const ALLOWED = [/^viz\//]

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : tsxFiles(p)
    return p.endsWith(".tsx") ? [p] : []
  })
}

describe("no raw hex colors in components", () => {
  it("every color in src/components/**/*.tsx comes from tokens", () => {
    const offenders: string[] = []
    for (const file of tsxFiles(ROOT)) {
      const rel = relative(ROOT, file).replaceAll("\\", "/")
      if (ALLOWED.some((rx) => rx.test(rel))) continue
      const src = readFileSync(file, "utf8")
      if (/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/.test(src)) offenders.push(rel)
    }
    expect(offenders, `raw hex found in: ${offenders.join(", ")}`).toEqual([])
  })
})
