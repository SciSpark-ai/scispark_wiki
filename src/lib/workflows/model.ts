import { PRICES } from "../llm/pricing"
import type { ScopedPrice } from "../llm/scoped-pricing"
import { DEFAULT_ENGINES } from "../engines/contracts"
import { ToolRefSchema, toolKey, type ToolRef } from "../extensions/contracts"
import { readProfileTools } from "../extensions/store"
import { loadSettings, resolveTier, type LLMSettings } from "../llm/settings"
import type { Tier } from "../llm/types"
import type { WorkflowContext } from "./context"
import { RunModelSchema, type RunModel } from "./contracts"

export function modelEndpoint(selection: RunModel["tierModels"][Tier]): string {
  const defaultUrl = selection.provider === "openai" ? "https://api.openai.com/v1"
    : selection.provider === "openrouter" ? "https://openrouter.ai/api/v1"
    : selection.provider === "google" ? "https://generativelanguage.googleapis.com" : "https://api.anthropic.com"
  if (selection.baseUrl && !["openai", "openrouter"].includes(selection.provider) && selection.baseUrl.replace(/\/+$/, "") !== defaultUrl) throw new Error("This provider does not support a custom endpoint")
  return selection.baseUrl ?? defaultUrl
}

/** Exact catalog identity only. The date is the catalog's provenance, not a live
 * pricing verification. Never apply a canonical quote to a proxy or alias. */
export function captureCatalogPrice(selection: RunModel["tierModels"][Tier]): ScopedPrice | undefined {
  const providerModels: Record<string, string[]> = {
    anthropic: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"],
    openai: ["gpt-5.6-sol", "gpt-5.4-mini"], google: ["gemini-3.1-pro-preview", "gemini-3.5-flash"],
  }
  const canonical = modelEndpoint({ provider: selection.provider, model: selection.model })
  if (modelEndpoint(selection).replace(/\/+$/, "") !== canonical || !providerModels[selection.provider]?.includes(selection.model)) return undefined
  const rates = PRICES[selection.model]
  if (!rates) return undefined
  return { provider: selection.provider, model: selection.model, baseUrl: canonical,
    rates: { inputPerMillion: rates.inPerM, outputPerMillion: rates.outPerM },
    provenance: "SciSpark pricing catalog; catalog verification dated 2026-07-12", recordedAt: "2026-07-12T00:00:00.000Z" }
}

/** Capture only explicit settings, never package instructions or credentials. */
export async function resolveRunModel(ctx: WorkflowContext, binding: ToolRef): Promise<RunModel> {
  const ref = ToolRefSchema.parse(binding)
  const settings = await loadSettings(ctx.storage)
  const engine = settings.engines ?? DEFAULT_ENGINES
  const override = (await readProfileTools(ctx))?.overrides.find((entry) => entry.toolKey === toolKey(ref))
  const select = (tier: Tier) => {
    const selected = override?.tierModels?.[tier] ?? resolveTier(settings, tier)
    if (engine.kind !== "api") {
      if (selected.provider !== (engine.kind === "codex" ? "openai" : "anthropic") || "baseUrl" in selected) throw new Error("A local engine override cannot change provider or endpoint")
      return selected
    }
    const baseUrl = "baseUrl" in selected ? selected.baseUrl : (selected.provider === "openai" || selected.provider === "openrouter") ? settings.baseUrls?.[selected.provider] : undefined
    return { ...selected, ...(baseUrl ? { baseUrl } : {}) }
  }
  const model = RunModelSchema.parse({ engine: engine.kind, tierModels: { fast: select("fast"), strong: select("strong") },
    roleTiers: { root: "strong", helper: "fast", ...override?.roleTiers }, timeoutSeconds: engine.timeoutSeconds })
  Object.values(model.tierModels).forEach(modelEndpoint)
  if (model.engine === "api") {
    const fast = captureCatalogPrice(model.tierModels.fast), strong = captureCatalogPrice(model.tierModels.strong)
    model.scopedPrices = { ...(fast ? { fast } : {}), ...(strong ? { strong } : {}) }
  }
  return model
}

/** Credentials are loaded inside the runtime, while all model choices stay captured.
 * Pass the dispatch tier because same-provider tiers may use different endpoints. */
export async function settingsForRunModel(ctx: WorkflowContext, input: RunModel, tier: Tier = "strong"): Promise<LLMSettings> {
  const model = RunModelSchema.parse(input)
  const live = await loadSettings(ctx.storage)
  const selected = model.tierModels[tier]
  modelEndpoint(selected)
  const engines = { ...DEFAULT_ENGINES, kind: model.engine, timeoutSeconds: model.timeoutSeconds ?? DEFAULT_ENGINES.timeoutSeconds,
    models: { ...DEFAULT_ENGINES.models, ...(model.engine !== "api" ? { [model.engine]: { fast: model.tierModels.fast.model, strong: model.tierModels.strong.model } } : {}) } }
  return { keys: live.keys, dailyBudgetUsd: live.dailyBudgetUsd, engines,
    tierModels: { fast: { provider: model.tierModels.fast.provider, model: model.tierModels.fast.model }, strong: { provider: model.tierModels.strong.provider, model: model.tierModels.strong.model } },
    baseUrls: selected.provider === "openai" || selected.provider === "openrouter" ? { [selected.provider]: modelEndpoint(selected) } : {} }
}
