import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { withSettingsWrite } from "../settings-write"
import { saveSettings, DEFAULT_SETTINGS } from "../../llm/settings"
import { saveCompanionSettings, DEFAULT_COMPANION_SETTINGS } from "../../companion/settings"
import { saveTrendingSettings } from "../../trending/settings"

const SETTINGS_PATH = ".scispark/settings.json"

describe("withSettingsWrite", () => {
  it("serializes concurrent cross-module saves without losing an update", async () => {
    const storage = new MemoryVaultStorage()
    // Fire all three saves concurrently against the same storage.
    await Promise.all([
      saveSettings(storage, { ...DEFAULT_SETTINGS, dailyBudgetUsd: 9 }),
      saveCompanionSettings(storage, { ...DEFAULT_COMPANION_SETTINGS, chattiness: "high" }),
      saveTrendingSettings(storage, { fields: [{ slug: "nlp", label: "NLP" }], cadence: "daily" }),
    ])
    const file = JSON.parse((await storage.read(SETTINGS_PATH))!)
    // All three top-level keys survive — no lost update.
    expect(file.llm.dailyBudgetUsd).toBe(9)
    expect(file.companion.chattiness).toBe("high")
    expect(file.trending).toEqual({ fields: [{ slug: "nlp", label: "NLP" }], cadence: "daily" })
  })

  it("withSettingsWrite applies the mutation to the parsed file and preserves siblings", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(SETTINGS_PATH, JSON.stringify({ other: 1 }))
    await withSettingsWrite(storage, (f) => ({ ...f, added: 2 }))
    expect(JSON.parse((await storage.read(SETTINGS_PATH))!)).toEqual({ other: 1, added: 2 })
  })
})
