import { describe, it, expect } from "vitest"
import { OPENALEX_FIELDS, canonicalAnchor } from "../openalex-fields"
import { manualAnchorError, deriveAnchorDisciplines } from "../anchors"
import { normalizeTrendingSettings } from "../settings"

describe("OpenAlex field catalog", () => {
  it("contains exactly the 26 unique official field IDs, not S2 categories", () => {
    expect(OPENALEX_FIELDS).toHaveLength(26)
    expect(new Set(OPENALEX_FIELDS.map((field) => field.id)).size).toBe(26)
    expect(new Set(OPENALEX_FIELDS.map((field) => field.domain)).size).toBe(4)
    expect(canonicalAnchor("28")).toEqual({ id: "https://openalex.org/fields/28", label: "Neuroscience" })
    expect(canonicalAnchor("fields/32")?.label).toBe("Psychology")
    expect(canonicalAnchor("999")).toBeUndefined()
    expect(canonicalAnchor("custom:neuroscience")).toBeUndefined()
    expect(canonicalAnchor("Neuroscience")).toBeUndefined()
  })
  it("validates IDs even in automatic mode and rejects canonical duplicates", () => {
    expect(manualAnchorError({ anchors: [{ id: "custom:foo", label: "Neuroscience" }], anchorsOverridden: false })).toContain("Replace custom")
    expect(manualAnchorError({ anchors: [{ id: "28" }, { id: "https://openalex.org/fields/28" }] })).toContain("different")
  })
  it("uses canonical labels for real IDs but preserves unknown legacy entries for review", () => {
    const old = { id: "custom:foo", label: "Hearing science" }
    const settings = normalizeTrendingSettings({ anchors: [{ id: "28", label: "Made up label" }, old] })
    expect(settings.anchors).toEqual([canonicalAnchor("28"), old])
    // An ID-only API selection is valid; normalization must not drop it.
    expect(normalizeTrendingSettings({ anchors: [{ id: "28" }] }).anchors).toEqual([canonicalAnchor("28")])
  })
  it("never lets suggestion responses invent fields or labels", async () => {
    const result = await deriveAnchorDisciplines(["hearing"], async () => [
      { key: "unknown", label: "Invented field", count: 9999 },
      { key: "28", label: "Wrong label from upstream", count: 50 },
    ], { fromDate: "2026-08-01", toDate: "2026-08-31" })
    expect(result).toEqual([canonicalAnchor("28")])
  })
})
