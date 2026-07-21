import { describe, it, expect } from "vitest"
import { displayVenue, venueYearLine } from "../venue"

describe("displayVenue", () => {
  it("strips the publisher parenthetical OpenAlex appends to preprint servers", () => {
    // The exact string Tong saw truncated as "bioRxiv (Cold Spring Harbo…".
    expect(displayVenue("bioRxiv (Cold Spring Harbor Laboratory)")).toBe("bioRxiv")
    expect(displayVenue("SSRN (Elsevier)")).toBe("SSRN")
  })

  it("leaves ordinary venue names untouched", () => {
    expect(displayVenue("PLoS Biology")).toBe("PLoS Biology")
    expect(displayVenue("PubMed Central")).toBe("PubMed Central")
  })

  it("keeps the text when the venue is ENTIRELY parenthesised (never collapses to nothing)", () => {
    expect(displayVenue("(Elsevier)")).toBe("(Elsevier)")
  })

  it("only strips a TRAILING parenthetical, not one mid-name", () => {
    expect(displayVenue("Journal of (Weird) Naming")).toBe("Journal of (Weird) Naming")
  })

  it("decodes markup/entities like every other displayed title", () => {
    expect(displayVenue("Journal of <i>Physiology</i>")).toBe("Journal of Physiology")
    expect(displayVenue("Cell &amp; Tissue")).toBe("Cell & Tissue")
  })

  it("returns undefined for missing or blank input", () => {
    expect(displayVenue(undefined)).toBeUndefined()
    expect(displayVenue(null)).toBeUndefined()
    expect(displayVenue("")).toBeUndefined()
    expect(displayVenue("   ")).toBeUndefined()
  })
})

describe("venueYearLine", () => {
  it("joins venue and year", () => {
    expect(venueYearLine("bioRxiv (Cold Spring Harbor Laboratory)", 2026)).toBe("bioRxiv · 2026")
  })

  it("omits the missing part instead of printing a placeholder", () => {
    // The card used to render a literal "no venue · 2026", which reads to a
    // user like a data error rather than an absent field.
    expect(venueYearLine(undefined, 2026)).toBe("2026")
    expect(venueYearLine("PLoS Biology", undefined)).toBe("PLoS Biology")
  })

  it("returns undefined when nothing is known, so the caller can omit the row", () => {
    expect(venueYearLine(undefined, undefined)).toBeUndefined()
    expect(venueYearLine("", null)).toBeUndefined()
  })
})
