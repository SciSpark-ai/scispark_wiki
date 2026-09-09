import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import {
  loadTrendingSettings,
  saveTrendingSettings,
  normalizeTrendingSettings,
  DEFAULT_TRENDING_SETTINGS,
} from "../settings"
import { MAX_ANCHORS } from "../anchors"

describe("trending settings", () => {
  it("defaults to weekly cadence + empty fields when unset", async () => {
    const storage = new MemoryVaultStorage()
    expect(await loadTrendingSettings(storage)).toEqual(DEFAULT_TRENDING_SETTINGS)
    expect(DEFAULT_TRENDING_SETTINGS.cadence).toBe("weekly")
    expect(DEFAULT_TRENDING_SETTINGS.fields).toEqual([])
    expect(DEFAULT_TRENDING_SETTINGS.anchors).toEqual([])
    expect(DEFAULT_TRENDING_SETTINGS.anchorsOverridden).toBe(false)
  })

  it("round-trips saved fields + cadence + anchors + anchorsOverridden", async () => {
    const storage = new MemoryVaultStorage()
    const next = {
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "daily" as const,
      anchors: [{ id: "https://openalex.org/fields/28", label: "Neuroscience" }],
      anchorsOverridden: true,
    }
    await saveTrendingSettings(storage, next)
    expect(await loadTrendingSettings(storage)).toEqual(next)
  })

  it("does not clobber a sibling 'llm' key in settings.json", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ llm: { keys: { openai: "sk" } } }))
    await saveTrendingSettings(storage, { fields: [], cadence: "weekly", anchors: [], anchorsOverridden: false })
    const raw = JSON.parse((await storage.read(".scispark/settings.json"))!)
    expect(raw.llm).toEqual({ keys: { openai: "sk" } })
    expect(raw.trending).toEqual({ fields: [], cadence: "weekly", anchors: [], anchorsOverridden: false })
  })

  it("falls back to defaults on an unknown cadence or malformed section", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ trending: { cadence: "hourly", fields: "nope" } }))
    expect(await loadTrendingSettings(storage)).toEqual(DEFAULT_TRENDING_SETTINGS)
  })

  it("dedupes fields by slug on save, keeping the first occurrence's label", async () => {
    const storage = new MemoryVaultStorage()
    await saveTrendingSettings(storage, {
      fields: [
        { slug: "nlp", label: "NLP" },
        { slug: "nlp", label: "nlp" },
      ],
      cadence: "weekly",
      anchors: [],
      anchorsOverridden: false,
    })
    const loaded = await loadTrendingSettings(storage)
    expect(loaded.fields).toEqual([{ slug: "nlp", label: "NLP" }])
  })

  it("dedupes fields by slug on load, for a hand-edited settings.json with duplicate slugs", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      ".scispark/settings.json",
      JSON.stringify({
        trending: {
          fields: [
            { slug: "nlp", label: "NLP" },
            { slug: "nlp", label: "Natural Language Processing" },
          ],
          cadence: "weekly",
        },
      }),
    )
    const loaded = await loadTrendingSettings(storage)
    expect(loaded.fields).toEqual([{ slug: "nlp", label: "NLP" }])
  })

  describe("anchors normalization", () => {
    it("absent anchors -> [] and anchorsOverridden -> false", () => {
      const result = normalizeTrendingSettings({ fields: [], cadence: "weekly" })
      expect(result.anchors).toEqual([])
      expect(result.anchorsOverridden).toBe(false)
    })

    it("a valid anchor pair survives", () => {
      const result = normalizeTrendingSettings({
        anchors: [
          { id: "field1", label: "Neuroscience" },
          { id: "field2", label: "Machine Learning" },
        ],
      })
      expect(result.anchors).toEqual([
        { id: "field1", label: "Neuroscience" },
        { id: "field2", label: "Machine Learning" },
      ])
    })

    it("drops an entry missing label", () => {
      const result = normalizeTrendingSettings({
        anchors: [{ id: "field1", label: "Neuroscience" }, { id: "field2" }],
      })
      expect(result.anchors).toEqual([{ id: "field1", label: "Neuroscience" }])
    })

    it("drops an entry missing id", () => {
      const result = normalizeTrendingSettings({
        anchors: [{ id: "field1", label: "Neuroscience" }, { label: "No id" }],
      })
      expect(result.anchors).toEqual([{ id: "field1", label: "Neuroscience" }])
    })

    it("drops an entry with empty-string id or label", () => {
      const result = normalizeTrendingSettings({
        anchors: [
          { id: "field1", label: "Neuroscience" },
          { id: "", label: "Empty id" },
          { id: "field3", label: "" },
        ],
      })
      expect(result.anchors).toEqual([{ id: "field1", label: "Neuroscience" }])
    })

    it("truncates more than MAX_ANCHORS entries", () => {
      const anchors = Array.from({ length: MAX_ANCHORS + 2 }, (_, i) => ({ id: `field${i}`, label: `Field ${i}` }))
      const result = normalizeTrendingSettings({ anchors })
      expect(result.anchors).toHaveLength(MAX_ANCHORS)
      expect(result.anchors).toEqual(anchors.slice(0, MAX_ANCHORS))
    })

    it("a non-array anchors value falls back to []", () => {
      const result = normalizeTrendingSettings({ anchors: "not-an-array" })
      expect(result.anchors).toEqual([])
    })

    it("a non-boolean anchorsOverridden falls back to false", () => {
      const result = normalizeTrendingSettings({ anchorsOverridden: "yes" })
      expect(result.anchorsOverridden).toBe(false)
    })

    it("a true anchorsOverridden survives", () => {
      const result = normalizeTrendingSettings({ anchorsOverridden: true })
      expect(result.anchorsOverridden).toBe(true)
    })
  })

  it("loads an existing on-disk settings file with only {fields, cadence} without throwing, gaining anchor defaults", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      ".scispark/settings.json",
      JSON.stringify({ trending: { fields: [{ slug: "nlp", label: "NLP" }], cadence: "daily" } }),
    )
    const loaded = await loadTrendingSettings(storage)
    expect(loaded).toEqual({
      fields: [{ slug: "nlp", label: "NLP" }],
      cadence: "daily",
      anchors: [],
      anchorsOverridden: false,
    })
  })
})
