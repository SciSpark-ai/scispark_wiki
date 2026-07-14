import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadTrendingSettings, saveTrendingSettings, DEFAULT_TRENDING_SETTINGS } from "../settings"

describe("trending settings", () => {
  it("defaults to weekly cadence + empty fields when unset", async () => {
    const storage = new MemoryVaultStorage()
    expect(await loadTrendingSettings(storage)).toEqual(DEFAULT_TRENDING_SETTINGS)
    expect(DEFAULT_TRENDING_SETTINGS.cadence).toBe("weekly")
    expect(DEFAULT_TRENDING_SETTINGS.fields).toEqual([])
  })

  it("round-trips saved fields + cadence", async () => {
    const storage = new MemoryVaultStorage()
    const next = { fields: [{ slug: "nlp", label: "NLP" }], cadence: "daily" as const }
    await saveTrendingSettings(storage, next)
    expect(await loadTrendingSettings(storage)).toEqual(next)
  })

  it("does not clobber a sibling 'llm' key in settings.json", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ llm: { keys: { openai: "sk" } } }))
    await saveTrendingSettings(storage, { fields: [], cadence: "weekly" })
    const raw = JSON.parse((await storage.read(".scispark/settings.json"))!)
    expect(raw.llm).toEqual({ keys: { openai: "sk" } })
    expect(raw.trending).toEqual({ fields: [], cadence: "weekly" })
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
})
