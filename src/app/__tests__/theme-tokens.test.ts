import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")

const SEMANTIC_VARS = [
  "--bg-page", "--bg-warm", "--surface-card", "--surface-light",
  "--text-primary", "--text-secondary", "--text-muted",
  "--accent", "--accent-light", "--tan", "--border", "--gold",
]

function block(selector: string): string {
  const start = css.indexOf(selector)
  expect(start, `selector ${selector} present`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf("}", start))
}

describe("theme tokens", () => {
  it("defines every semantic var for light (:root) and dark ([data-theme='dark'])", () => {
    const root = block(":root")
    const dark = block('[data-theme="dark"]')
    for (const v of SEMANTIC_VARS) {
      expect(root, `light ${v}`).toContain(`${v}:`)
      expect(dark, `dark ${v}`).toContain(`${v}:`)
    }
  })

  it("maps @theme colors to semantic vars instead of raw hex", () => {
    const theme = block("@theme inline")
    expect(theme).toContain("--color-page-bg: var(--bg-page)")
    expect(theme).toContain("--color-espresso: var(--text-primary)")
    expect(theme).toContain("--color-border-warm: var(--border)")
    expect(theme).not.toMatch(/--color-[a-z-]+:\s*#/)
  })

  it("body uses tokens, not hardcoded hex", () => {
    const base = css.slice(css.indexOf("@layer base"), css.indexOf("@layer utilities"))
    expect(base).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
