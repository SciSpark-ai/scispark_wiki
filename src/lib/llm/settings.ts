import type { VaultStorage } from "../vault/storage"
import { withSettingsWrite } from "../vault/settings-write"
import type { LLMProvider, ProviderId, Tier } from "./types"
import { LLMError } from "./types"
import { AnthropicProvider } from "./providers/anthropic"
import { OpenAICompatProvider, openAIProvider, openRouterProvider } from "./providers/openai-compat"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "")
}
import { GoogleProvider } from "./providers/google"

const SETTINGS_PATH = ".scispark/settings.json"

export interface LLMSettings {
  keys: Partial<Record<ProviderId, string>>
  tierModels: Record<Tier, { provider: ProviderId; model: string }>
  dailyBudgetUsd: number
  /**
   * Optional base-URL overrides for the OpenAI-compatible providers, enabling
   * third-party OpenAI-compatible endpoints (e.g. GMI Cloud at
   * https://api.gmi-serving.com/v1) to be used under the "openai" or
   * "openrouter" provider ids with the user's own key.
   */
  baseUrls?: Partial<Record<"openai" | "openrouter", string>>
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
    ...(llm.baseUrls ? { baseUrls: { ...llm.baseUrls } } : {}),
  }
}

export async function saveSettings(storage: VaultStorage, settings: LLMSettings): Promise<void> {
  await withSettingsWrite(storage, (file) => ({ ...file, llm: settings }))
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
      return settings.baseUrls?.openai
        ? new OpenAICompatProvider("openai", key, stripTrailingSlash(settings.baseUrls.openai), fetchFn)
        : openAIProvider(key, fetchFn)
    case "google":
      return new GoogleProvider(key, fetchFn)
    case "openrouter":
      return settings.baseUrls?.openrouter
        ? new OpenAICompatProvider("openrouter", key, stripTrailingSlash(settings.baseUrls.openrouter), fetchFn)
        : openRouterProvider(key, fetchFn)
    default: {
      const exhaustive: never = provider
      throw new Error(`unknown provider: ${exhaustive as string}`)
    }
  }
}
