import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { describe, expect, it, vi } from "vitest"

const { loader } = vi.hoisted(() => ({
  loader: vi.fn((options: { variable: string }) => ({ variable: options.variable })),
}))
vi.mock("next/font/local", () => ({ default: loader }))
import { geistSans, geistMono, halant } from "../fonts"

const root = resolve(process.cwd(), "src")
const files = [
  ["Geist-Variable.ttf", "73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659"],
  ["GeistMono-Variable.ttf", "d00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196"],
  ["Halant-Regular.ttf", "f646ffa1cdf2d4ab36326943d3494c98416264f4df40f8e7bf86211de571df07"],
  ["Halant-Bold.ttf", "ee33e5ad2f8b8ff03ef91b286ea3bf93583cc162b614790e2ddcfd5772939daf"],
]

describe("bundled offline fonts", () => {
  it("preserves the existing CSS variables, weight ranges and font families", () => {
    expect([geistSans.variable, geistMono.variable, halant.variable]).toEqual(["--font-geist-sans", "--font-geist-mono", "--font-halant"])
    expect(loader.mock.calls.map(([options]) => options)).toMatchObject([
      { src: "../assets/fonts/Geist-Variable.ttf", weight: "100 900", display: "swap" },
      { src: "../assets/fonts/GeistMono-Variable.ttf", weight: "100 900", display: "swap" },
      { src: [
        { path: "../assets/fonts/Halant-Regular.ttf", weight: "400" },
        { path: "../assets/fonts/Halant-Bold.ttf", weight: "700" },
      ], display: "swap", adjustFontFallback: "Times New Roman" },
    ])
  })

  it.each(files)("ships the complete, pinned %s font binary", (name, checksum) => {
    const data = readFileSync(join(root, "assets/fonts", name))
    expect(data.readUInt32BE(0)).toBe(0x00010000) // TrueType, not an HTML download error
    expect(createHash("sha256").update(data).digest("hex")).toBe(checksum)
  })

  it("includes upstream license notices", () => {
    for (const family of ["geist", "halant"]) {
      const license = readFileSync(join(root, "assets/fonts", family + "-OFL.txt"), "utf8")
      expect(license).toContain("Copyright")
      expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1")
    }
  })

  it("does not reintroduce remote font loading anywhere in application source", () => {
    const visit = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === "__tests__") return []
      const file = join(dir, entry.name)
      return entry.isDirectory() ? visit(file) : /\.(tsx?|css)$/.test(file) ? [file] : []
    })
    const remote = visit(root).filter((file) => /next\/font\/google|fonts\.(googleapis|gstatic)\.com/.test(readFileSync(file, "utf8")))
    expect(remote).toEqual([])
  })
})
