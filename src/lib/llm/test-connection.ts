import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "./types"
import { loadSettings } from "./settings"
import { addCosts } from "./pricing"
import { defineSkill } from "../skills/types"
import { runSkill } from "../skills/runner"

const connectionSkill = defineSkill({
  name: "connection-test", version: "1",
  run: (ctx, input: { tier: Tier }) => ctx.llmStructured(input.tier, {
    messages: [{ role: "user", content: "Connection test: reply with the word ready in the message field." }],
    maxTokens: 256, thinking: "disabled",
  }, z.object({ message: z.string().trim().min(1).max(100) }).strict(), { schemaName: "connection_test" }),
})

export interface ConnectionTestResult {
  status: "ok" | "error"
  costUsd: number | null
  testedTiers: Tier[]
  error?: string
}

/** Test the same configuration used by onboarding and feed assessment. Reuse a
 * successful call only when both tiers have the same provider and model. */
export async function testConnection(storage: VaultStorage, providerOverride?: Partial<Record<Tier, LLMProvider>>): Promise<ConnectionTestResult> {
  const settings = await loadSettings(storage)
  const testedTiers: Tier[] = []
  let costUsd: number | null = 0
  for (const tier of ["strong", "fast"] as const) {
    if (tier === "fast" && settings.tierModels.fast.provider === settings.tierModels.strong.provider &&
      settings.tierModels.fast.model === settings.tierModels.strong.model) {
      testedTiers.push(tier)
      continue
    }
    const run = await runSkill({ skill: connectionSkill, input: { tier }, storage, settings, providerOverride })
    costUsd = addCosts(costUsd, run.costUsd)
    // Do not reflect raw provider errors: some gateways echo credentials or
    // request headers. Keep the user-facing failure actionable but secret-free.
    if (run.status !== "ok") return { status: "error", costUsd, testedTiers,
      error: `The ${tier === "strong" ? "analysis" : "quick-steps"} model (${settings.tierModels[tier].model}) did not pass the connection test. ${run.status === "budget_exceeded" ? "Your local AI budget was reached. Adjust it in Settings and retry." : "Check model access, your API key, the server URL and your provider’s usage limit, then retry."}` }
    testedTiers.push(tier)
  }
  return { status: "ok", costUsd, testedTiers }
}
