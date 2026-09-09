import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("home paid-provider gate", () => {
  it("does not start a trending LLM refresh merely by opening the app", () => {
    const source = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8")
    expect(source).not.toContain("autoRefreshTrending")
    expect(source).not.toContain("/api/skills/trending/auto-refresh")
  })
})
