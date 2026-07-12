import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, ProviderId, Tier } from "./types"
import { LLMError } from "./types"
import { AnthropicProvider } from "./providers/anthropic"
import { openAIProvider, openRouterProvider } from "./providers/openai-compat"
import { GoogleProvider } from "./providers/google"

const SETTINGS_PATH = ".scispark/settings.json"

export interface LLMSettings {
  keys: Partial<Record<ProviderId, string>>
  tierModels: Record<Tier, { provider: ProviderId; model: string }>
  dailyBudgetUsd: number
}

/**
 * `.scispark/settings.json` layout: LLM settings live nested under a top-level
 * "llm" key so sibling top-level keys (e.g. future M1 debug-page settings)
 * can coexist in the same file without collision.
 *   { "llm": { "keys": {...}, "tierModels": {...}, "dailyBudgetUsd": 5 }, "other": ... }
 */
export const DEFAULT_SETTINGS: LLMSettings = {
  keys: {},
  tierModels: {
    fast: { provider: "anthropic", model: "claude-haiku-4-5" },
    strong: { provider: "anthropic", model: "claude-opus-4-8" },
  },
  dailyBudgetUsd: 5,
}

export class MissingKeyError extends LLMError {
  constructor(public provider: ProviderId) {
    super(`Missing API key for provider "${provider}"`)
  }
}

async function readJsonFile(storage: VaultStorage): Promise<Record<string, unknown>> {
  const raw = await storage.read(SETTINGS_PATH)
  if (raw == null) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function loadSettings(storage: VaultStorage): Promise<LLMSettings> {
  const file = await readJsonFile(storage)
  const llm = (file.llm !== null && typeof file.llm === "object" ? file.llm : {}) as Partial<LLMSettings>

  return {
    keys: { ...DEFAULT_SETTINGS.keys, ...(llm.keys ?? {}) },
    tierModels: {
      fast: { ...DEFAULT_SETTINGS.tierModels.fast, ...(llm.tierModels?.fast ?? {}) },
      strong: { ...DEFAULT_SETTINGS.tierModels.strong, ...(llm.tierModels?.strong ?? {}) },
    },
    dailyBudgetUsd: llm.dailyBudgetUsd ?? DEFAULT_SETTINGS.dailyBudgetUsd,
  }
}

export async function saveSettings(storage: VaultStorage, settings: LLMSettings): Promise<void> {
  const file = await readJsonFile(storage)
  const next = { ...file, llm: settings }
  await storage.write(SETTINGS_PATH, JSON.stringify(next, null, 2))
}

export function resolveTier(settings: LLMSettings, tier: Tier): { provider: ProviderId; model: string } {
  return settings.tierModels[tier]
}

export function buildProvider(settings: LLMSettings, tier: Tier, fetchFn?: typeof fetch): LLMProvider {
  const { provider } = resolveTier(settings, tier)
  const key = settings.keys[provider]
  if (!key) throw new MissingKeyError(provider)

  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(key, fetchFn)
    case "openai":
      return openAIProvider(key, fetchFn)
    case "google":
      return new GoogleProvider(key, fetchFn)
    case "openrouter":
      return openRouterProvider(key, fetchFn)
    default: {
      const exhaustive: never = provider
      throw new Error(`unknown provider: ${exhaustive as string}`)
    }
  }
}
