import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, buildProvider, resolveTier, MissingKeyError,
} from "../settings"
import { AnthropicProvider } from "../providers/anthropic"
import { OpenAICompatProvider } from "../providers/openai-compat"
import { GoogleProvider } from "../providers/google"

describe("settings", () => {
  describe("loadSettings", () => {
    it("returns DEFAULT_SETTINGS on empty storage", async () => {
      const storage = new MemoryVaultStorage()
      const settings = await loadSettings(storage)
      expect(settings).toEqual(DEFAULT_SETTINGS)
    })

    it("deep-merges a partial llm settings file with defaults", async () => {
      const storage = new MemoryVaultStorage()
      await storage.write(".scispark/settings.json", JSON.stringify({ llm: { dailyBudgetUsd: 2 } }))
      const settings = await loadSettings(storage)
      expect(settings.dailyBudgetUsd).toBe(2)
      // untouched fields fall back to defaults
      expect(settings.tierModels).toEqual(DEFAULT_SETTINGS.tierModels)
      expect(settings.keys).toEqual({})
    })

    it("merges a partial tierModels entry per-tier rather than replacing the whole map", async () => {
      const storage = new MemoryVaultStorage()
      await storage.write(
        ".scispark/settings.json",
        JSON.stringify({ llm: { tierModels: { fast: { provider: "openai", model: "gpt-5-mini" } } } }),
      )
      const settings = await loadSettings(storage)
      expect(settings.tierModels.fast).toEqual({ provider: "openai", model: "gpt-5-mini" })
      // strong tier was not present in the partial file, so it falls back to the default
      expect(settings.tierModels.strong).toEqual(DEFAULT_SETTINGS.tierModels.strong)
    })
  })

  describe("saveSettings", () => {
    it("round-trips through save then load", async () => {
      const storage = new MemoryVaultStorage()
      const custom = {
        keys: { anthropic: "sk-abc" },
        tierModels: {
          fast: { provider: "anthropic" as const, model: "claude-haiku-4-5" },
          strong: { provider: "openai" as const, model: "gpt-5" },
        },
        dailyBudgetUsd: 10,
      }
      await saveSettings(storage, custom)
      const loaded = await loadSettings(storage)
      expect(loaded).toEqual(custom)
    })

    it("preserves pre-existing sibling top-level keys in settings.json", async () => {
      const storage = new MemoryVaultStorage()
      await storage.write(".scispark/settings.json", JSON.stringify({ other: 1 }))
      await saveSettings(storage, { ...DEFAULT_SETTINGS, dailyBudgetUsd: 7 })
      const raw = await storage.read(".scispark/settings.json")
      const parsed = JSON.parse(raw as string)
      expect(parsed.other).toBe(1)
      expect(parsed.llm.dailyBudgetUsd).toBe(7)
    })
  })

  describe("resolveTier", () => {
    it("returns the provider+model for a tier", () => {
      const resolved = resolveTier(DEFAULT_SETTINGS, "fast")
      expect(resolved).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" })
    })
  })

  describe("buildProvider", () => {
    it("returns an AnthropicProvider for the default fast tier when keys.anthropic is set", () => {
      const settings = { ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }
      const provider = buildProvider(settings, "fast")
      expect(provider).toBeInstanceOf(AnthropicProvider)
      expect(provider.id).toBe("anthropic")
    })

    it("throws MissingKeyError naming the provider when the key is absent", () => {
      const settings = { ...DEFAULT_SETTINGS, keys: {} }
      try {
        buildProvider(settings, "fast")
        expect.unreachable("expected buildProvider to throw")
      } catch (e) {
        expect(e).toBeInstanceOf(MissingKeyError)
        expect((e as MissingKeyError).provider).toBe("anthropic")
      }
    })

    it("throws MissingKeyError when the key is present but empty", () => {
      const settings = { ...DEFAULT_SETTINGS, keys: { anthropic: "" } }
      try {
        buildProvider(settings, "fast")
        expect.unreachable("expected buildProvider to throw")
      } catch (e) {
        expect(e).toBeInstanceOf(MissingKeyError)
        expect((e as MissingKeyError).provider).toBe("anthropic")
      }
    })

    it("constructs an OpenAICompatProvider with id 'openai' for an openai tier mapping", () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        keys: { openai: "sk-openai" },
        tierModels: {
          ...DEFAULT_SETTINGS.tierModels,
          fast: { provider: "openai" as const, model: "gpt-5-mini" },
        },
      }
      const provider = buildProvider(settings, "fast")
      expect(provider).toBeInstanceOf(OpenAICompatProvider)
      expect(provider.id).toBe("openai")
    })

    it("constructs a GoogleProvider for a google tier mapping", () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        keys: { google: "sk-google" },
        tierModels: {
          ...DEFAULT_SETTINGS.tierModels,
          strong: { provider: "google" as const, model: "gemini-pro" },
        },
      }
      const provider = buildProvider(settings, "strong")
      expect(provider).toBeInstanceOf(GoogleProvider)
      expect(provider.id).toBe("google")
    })
  })
})
