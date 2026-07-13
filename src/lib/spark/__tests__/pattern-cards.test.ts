import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { loadPatternCards, patternIndex, cardsByIds } from "../pattern-cards"
import { GENERATED_CARDS } from "../pattern-cards/generated-cards"

describe("loadPatternCards", () => {
  it("returns the 46-card catalog, each with non-empty id/alias/signature/body", () => {
    const cards = loadPatternCards()
    expect(cards.length).toBe(46) // 15 patterns + 31 sub-patterns (design spec)
    for (const card of cards) {
      expect(card.id.length).toBeGreaterThan(0)
      expect(card.alias.length).toBeGreaterThan(0)
      expect(card.signature.length).toBeGreaterThan(0)
      expect(card.body.length).toBeGreaterThan(0)
      expect(["pattern", "sub-pattern"]).toContain(card.kind)
    }
  })

  it("has no duplicate ids", () => {
    const cards = loadPatternCards()
    const ids = cards.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("includes the 15 top-level patterns and 31 sub-patterns, excluding the reference/index docs", () => {
    const cards = loadPatternCards()
    expect(cards.filter((c) => c.kind === "pattern").length).toBe(15)
    expect(cards.filter((c) => c.kind === "sub-pattern").length).toBe(31)
    // The reference/index docs are NOT ideation cards.
    expect(cards.find((c) => c.id.includes("overview"))).toBeUndefined()
    expect(cards.find((c) => c.id.includes("companion-combos"))).toBeUndefined()
  })

  it("parses a known pattern card's structured fields exactly", () => {
    const cards = loadPatternCards()
    const card = cards.find((c) => c.id === "adapt_via_conditioning")
    expect(card).toBeDefined()
    expect(card!.alias).toBe("Adapt by conditioning, not retraining")
    expect(card!.signature).toBe(
      "identify a new task → express it as conditioning (examples, retrieval, goals, unified format) → solve it at inference without parameter updates",
    )
    expect(card!.kind).toBe("pattern")
    expect(card!.body).toContain("# Adapt by Conditioning, Not Retraining")
  })

  it("falls back gracefully for a sub-pattern cluster card lacking the standard structure", () => {
    const cards = loadPatternCards()
    const card = cards.find((c) => c.id === "C00")
    expect(card).toBeDefined()
    expect(card!.kind).toBe("sub-pattern")
    // No "**Plain alias**" line on cluster cards — falls back to the stated parent pattern name.
    expect(card!.alias).toBe("Reframe as a Solvable Object")
    expect(card!.signature.length).toBeGreaterThan(0)
  })
})

describe("patternIndex", () => {
  it("emits exactly one line per card, each naming the card's id/alias/signature", () => {
    const cards = loadPatternCards()
    const index = patternIndex(cards)
    const lines = index.split("\n")
    expect(lines.length).toBe(cards.length)
    for (const card of cards) {
      expect(index).toContain(`- ${card.id} (${card.alias}): ${card.signature}`)
    }
  })
})

describe("cardsByIds", () => {
  it("filters to the requested ids, preserving requested order and dropping unknown ids", () => {
    const cards = loadPatternCards()
    const filtered = cardsByIds(cards, ["C00", "unknown_id", "adapt_via_conditioning"])
    expect(filtered.map((c) => c.id)).toEqual(["C00", "adapt_via_conditioning"])
  })

  it("returns [] for an empty id list", () => {
    const cards = loadPatternCards()
    expect(cardsByIds(cards, [])).toEqual([])
  })
})

describe("bundled attribution files", () => {
  const root = join(__dirname, "..", "pattern-cards")

  it("includes LICENSE (MIT) and a NOTICE.md crediting microsoft/ResearchStudio", () => {
    expect(existsSync(join(root, "LICENSE"))).toBe(true)
    expect(existsSync(join(root, "NOTICE.md"))).toBe(true)
    const license = readFileSync(join(root, "LICENSE"), "utf8")
    expect(license).toContain("MIT License")
    const notice = readFileSync(join(root, "NOTICE.md"), "utf8")
    expect(notice).toContain("microsoft/ResearchStudio")
    expect(notice).toContain("MIT License")
  })
})

describe("generated-cards.ts staleness guard", () => {
  // The generated module is committed so loadPatternCards needs no runtime fs/glob.
  // This guard fails if someone hand-edits a source .md card (or adds/removes one)
  // without re-running scripts/generate-spark-cards.mjs — otherwise the drift would
  // silently ship stale card text into the ideation prompt.
  const root = join(__dirname, "..", "pattern-cards")

  for (const [dir, kind] of [
    ["patterns", "pattern"],
    ["sub-patterns", "sub-pattern"],
  ] as const) {
    it(`${dir}/ source .md files match the generated module byte-for-byte`, () => {
      const files = readdirSync(join(root, dir)).filter((f) => f.endsWith(".md")).sort()
      for (const file of files) {
        const raw = readFileSync(join(root, dir, file), "utf8")
        const entry = GENERATED_CARDS.find((c) => c.kind === kind && c.file === file)
        expect(entry, `generated-cards missing ${dir}/${file} — re-run scripts/generate-spark-cards.mjs`).toBeDefined()
        expect(entry!.raw, `${dir}/${file} drifted from generated-cards — re-run the generator`).toBe(raw)
      }
      // And nothing generated that isn't on disk.
      const generatedForKind = GENERATED_CARDS.filter((c) => c.kind === kind).map((c) => c.file).sort()
      expect(generatedForKind).toEqual(files)
    })
  }
})
