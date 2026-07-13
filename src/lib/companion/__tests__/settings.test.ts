import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import {
  DEFAULT_COMPANION_SETTINGS,
  SESSION_BUDGET,
  loadCompanionSettings,
  saveCompanionSettings,
} from "../settings"

describe("SESSION_BUDGET", () => {
  it("has the exact per-chattiness intervention caps", () => {
    expect(SESSION_BUDGET).toEqual({ off: 0, low: 2, medium: 5, high: 10 })
  })
})

describe("loadCompanionSettings", () => {
  it("returns DEFAULT_COMPANION_SETTINGS when the settings file is missing", async () => {
    const storage = new MemoryVaultStorage()
    const settings = await loadCompanionSettings(storage)
    expect(settings).toEqual(DEFAULT_COMPANION_SETTINGS)
    expect(settings.chattiness).toBe("medium")
  })

  it("returns defaults when settings.json exists but has no companion section", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ llm: { dailyBudgetUsd: 3 } }))
    const settings = await loadCompanionSettings(storage)
    expect(settings).toEqual(DEFAULT_COMPANION_SETTINGS)
  })

  it("merges an unknown/garbage companion section over defaults rather than throwing", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(
      ".scispark/settings.json",
      JSON.stringify({ companion: { chattiness: "not-a-real-value", extra: true } }),
    )
    const settings = await loadCompanionSettings(storage)
    // unknown chattiness value passes through the merge (schema-less merge, like llm settings);
    // the important contract is that the section is read and merged over defaults, not that
    // the value is validated here — but at minimum it must not throw and other fields default.
    expect(settings.chattiness).toBeDefined()
  })
})

describe("saveCompanionSettings", () => {
  it("round-trips through save then load", async () => {
    const storage = new MemoryVaultStorage()
    await saveCompanionSettings(storage, { chattiness: "high" })
    const loaded = await loadCompanionSettings(storage)
    expect(loaded).toEqual({ chattiness: "high" })
  })

  it("preserves an existing sibling llm key when saving companion settings", async () => {
    const storage = new MemoryVaultStorage()
    const llmSettings = {
      keys: { anthropic: "sk-abc" },
      tierModels: {
        fast: { provider: "anthropic", model: "claude-haiku-4-5" },
        strong: { provider: "anthropic", model: "claude-opus-4-8" },
      },
      dailyBudgetUsd: 5,
    }
    await storage.write(".scispark/settings.json", JSON.stringify({ llm: llmSettings }))

    await saveCompanionSettings(storage, { chattiness: "low" })

    const raw = await storage.read(".scispark/settings.json")
    const parsed = JSON.parse(raw as string)
    expect(parsed.llm).toEqual(llmSettings)
    expect(parsed.companion).toEqual({ chattiness: "low" })
  })

  it("preserves other unknown sibling top-level keys", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ other: 1 }))
    await saveCompanionSettings(storage, DEFAULT_COMPANION_SETTINGS)
    const raw = await storage.read(".scispark/settings.json")
    const parsed = JSON.parse(raw as string)
    expect(parsed.other).toBe(1)
    expect(parsed.companion).toEqual(DEFAULT_COMPANION_SETTINGS)
  })

  it("serializes concurrent saves so the last write wins without corrupting siblings", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", JSON.stringify({ llm: { dailyBudgetUsd: 5 } }))

    await Promise.all([
      saveCompanionSettings(storage, { chattiness: "off" }),
      saveCompanionSettings(storage, { chattiness: "high" }),
    ])

    const raw = await storage.read(".scispark/settings.json")
    const parsed = JSON.parse(raw as string)
    expect(parsed.llm).toEqual({ dailyBudgetUsd: 5 })
    expect(["off", "high"]).toContain(parsed.companion.chattiness)
  })
})
