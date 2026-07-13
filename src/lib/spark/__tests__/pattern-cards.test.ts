import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { loadPatternCards, patternIndex, cardsByIds } from "../pattern-cards"

describe("loadPatternCards", () => {
  it("returns at least 49 cards, each with non-empty id/alias/signature/body", () => {
    const cards = loadPatternCards()
    expect(cards.length).toBeGreaterThanOrEqual(49)
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

  it("includes the 17 top-level patterns and 32 sub-patterns", () => {
    const cards = loadPatternCards()
    expect(cards.filter((c) => c.kind === "pattern").length).toBe(17)
    expect(cards.filter((c) => c.kind === "sub-pattern").length).toBe(32)
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
