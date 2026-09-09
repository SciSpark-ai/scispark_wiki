import { describe, it, expect, vi } from "vitest"
import { OPENALEX_SUBFIELDS, openAlexSubfield, subfieldsForField } from "../openalex-subfields"
import { canonicalAnchor, openAlexField } from "../openalex-fields"
import { manualAnchorError } from "../anchors"
import { normalizeTrendingSettings, saveTrendingSettings, loadTrendingSettings } from "../settings"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { anchorsMatchBoard, TRENDING_BOARD_VERSION } from "../cache"
import type { TrendingBoard } from "../types"
import { countOpenAlexWorks, groupWorksByTopic, searchTopCitedWorks } from "../../papers/openalex"

const neuro = canonicalAnchor("28")!
const cognitive = "https://openalex.org/subfields/2805"
const sensory = "https://openalex.org/subfields/2809"

describe("optional OpenAlex subfields", () => {
  it("bundles 252 unique official children, each with an official parent", () => {
    expect(OPENALEX_SUBFIELDS).toHaveLength(252)
    expect(new Set(OPENALEX_SUBFIELDS.map((s) => s.id)).size).toBe(252)
    expect(OPENALEX_SUBFIELDS.every((s) => openAlexField(s.fieldId))).toBe(true)
    expect(openAlexSubfield("subfields/2805")).toEqual({ id: cognitive, label: "Cognitive Neuroscience", fieldId: neuro.id })
    expect(subfieldsForField("28")).toHaveLength(8)
    expect(subfieldsForField("28").every((s) => s.fieldId === neuro.id)).toBe(true)
    expect(subfieldsForField("999")).toEqual([])
  })
  it.each([["9999"], ["2718"], ["2805", cognitive], ["2805|2809"], [null], "2805", null])("rejects invalid or foreign children %j without broadening on load", (subfieldIds) => {
    const raw = { anchors: [{ ...neuro, subfieldIds }], anchorsOverridden: true }
    expect(manualAnchorError(raw)).not.toBeNull()
    expect(manualAnchorError(normalizeTrendingSettings(raw))).not.toBeNull()
  })
  it("saves canonical IDs, preserves siblings, and permits the entire field", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ companion: { enabled: true } }))
    const settings = normalizeTrendingSettings({ anchors: [{ ...neuro, subfieldIds: ["2805", "2809"] }], anchorsOverridden: true })
    await saveTrendingSettings(storage, settings)
    expect((await loadTrendingSettings(storage)).anchors).toEqual([{ ...neuro, subfieldIds: [cognitive, sensory] }])
    expect(JSON.parse((await storage.read(".scispark/settings.json"))!).companion).toEqual({ enabled: true })
    for (const subfieldIds of [undefined, []]) {
      expect(manualAnchorError({ anchors: [{ ...neuro, subfieldIds }], anchorsOverridden: true })).toBeNull()
    }
  })
  it("invalidates cached metrics when children change, but ignores selection order", () => {
    const board = { version: TRENDING_BOARD_VERSION, anchors: [{ ...neuro, subfieldIds: [cognitive, sensory] }] } as TrendingBoard
    expect(anchorsMatchBoard(board, [{ ...neuro, subfieldIds: [sensory, cognitive] }])).toBe(true)
    expect(anchorsMatchBoard(board, [{ ...neuro, subfieldIds: [cognitive] }])).toBe(false)
    expect(anchorsMatchBoard(board, [neuro])).toBe(false)
    const broad = { ...board, anchors: [neuro] }
    expect(anchorsMatchBoard(broad, [{ ...neuro, subfieldIds: [] }])).toBe(true)
    expect(anchorsMatchBoard(broad, [{ ...neuro, subfieldIds: [cognitive] }])).toBe(false)
  })
  it.each([countOpenAlexWorks, groupWorksByTopic, searchTopCitedWorks])("rejects invalid subfields before requesting OpenAlex", async (adapter) => {
    const fetchFn = vi.fn()
    await expect(adapter({ query: "", fieldId: "28", subfieldIds: ["2718"], fromDate: "2026-08-01", toDate: "2026-08-31" }, { fetchFn })).rejects.toThrow("Subfields must belong")
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
