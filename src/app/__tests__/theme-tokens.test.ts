import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")

const SEMANTIC_VARS = [
  "--bg-page", "--bg-warm", "--surface-card", "--surface-light",
  "--text-primary", "--text-secondary", "--text-muted",
  "--accent-ink", "--accent-ink-hover", "--on-accent",
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

function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map((part) => {
    const value = parseInt(part, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe("research text contrast", () => {
  for (const selector of [":root", '[data-theme="dark"]']) {
    it(`${selector} keeps metadata and accent text readable on existing surfaces`, () => {
      const values = Object.fromEntries([...block(selector).matchAll(/(--[\w-]+):\s*(#[a-f\d]{6})/gi)].map((m) => [m[1], m[2]]))
      for (const text of ["--text-muted", "--accent-ink", "--accent-ink-hover"]) {
        for (const surface of ["--bg-page", "--bg-warm", "--surface-card", "--surface-light"]) {
          expect(contrast(values[text], values[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      expect(contrast(values["--on-accent"], values["--accent"])).toBeGreaterThanOrEqual(4.5)
    })
  }
})
