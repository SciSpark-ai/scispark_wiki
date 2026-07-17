import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("wiki index copy (C2)", () => {
  it("has no changeset/skill jargon on the user surface", () => {
    const src = readFileSync(join(process.cwd(), "src/app/wiki/page.tsx"), "utf8")
    expect(src).not.toContain("Recent ingests")
    expect(src).not.toContain("listIngests")
  })
})
