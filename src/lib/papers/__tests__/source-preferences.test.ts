import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { readEnabledPaperSources } from "../source-preferences"
import { savePaperSourceSettings, saveS2Key } from "../../server/paper-source-settings"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"

describe("saved paper sources", () => {
  it("defaults legacy and fresh vaults to all four sources", async () => {
    const storage = new MemoryVaultStorage()
    expect(await readEnabledPaperSources(storage)).toEqual(["arxiv", "openalex", "s2", "pubmed"])
    await storage.write(".scispark/settings.json", JSON.stringify({ paperSources: { s2: { apiKey: "private" } } }))
    expect(await readEnabledPaperSources(storage)).toHaveLength(4)
  })
  it.each(["broken-private-text", "[]", "null", '{"paperSources":null}', '{"paperSources":{"enabledSources":[]}}', '{"paperSources":{"enabledSources":["bogus-secret"]}}'])("fails closed on malformed preferences without quoting settings: %s", async (raw) => {
    const storage = new MemoryVaultStorage()
    await storage.write(".scispark/settings.json", raw)
    await expect(readEnabledPaperSources(storage)).rejects.toThrow("Invalid paper source")
    await expect(readEnabledPaperSources(storage)).rejects.not.toThrow("secret")
  })
  it("preserves concurrent selection, credential and AI-settings saves", async () => {
    const storage = new MemoryVaultStorage()
    await Promise.all([
      savePaperSourceSettings(storage, { enabledSources: ["arxiv", "pubmed"] }),
      saveS2Key(storage, "source-secret"),
      saveSettings(storage, { ...DEFAULT_SETTINGS, keys: { openai: "ai-secret" } }),
    ])
    expect(await readEnabledPaperSources(storage)).toEqual(["arxiv", "pubmed"])
    const file = JSON.parse((await storage.read(".scispark/settings.json"))!)
    expect(file.paperSources.s2.apiKey).toBe("source-secret")
    expect(file.llm.keys.openai).toBe("ai-secret")
    await saveS2Key(storage, null)
    expect(await readEnabledPaperSources(storage)).toEqual(["arxiv", "pubmed"])
  })
})
