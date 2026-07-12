import type { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, LLMUsage, Tier } from "../llm/types"
import { loadSettings, resolveTier, buildProvider, type LLMSettings } from "../llm/settings"
import { Meter, checkBudget, BudgetExceededError } from "../llm/metering"
import { withRetry } from "../llm/retry"
import { completeStructured } from "../llm/structured"
import { estimateCostUsd } from "../llm/pricing"
import type { SkillContext, SkillDefinition, SkillRunResult } from "./types"

function makeRunId(now: () => Date): string {
  const hex = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0")
  return `run-${now().getTime()}-${hex}`
}

/**
 * Runs a skill through the harness: every LLM call the skill makes via `ctx.llm`/
 * `ctx.llmStructured` is budget-checked, retried on transient failure, metered, and
 * accumulated into a total the run record persists regardless of outcome.
 */
export async function runSkill<I, O>(opts: {
  skill: SkillDefinition<I, O>
  input: I
  storage: VaultStorage
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
}): Promise<SkillRunResult<O>> {
  const now = opts.now ?? (() => new Date())
  const settings = opts.settings ?? (await loadSettings(opts.storage))
  const meter = new Meter(opts.storage, now)
  const runId = makeRunId(now)

  const totals: LLMUsage = { inputTokens: 0, outputTokens: 0 }
  let costUsd = 0
  const logs: string[] = []

  function accumulate(model: string, usage: LLMUsage): void {
    totals.inputTokens += usage.inputTokens
    totals.outputTokens += usage.outputTokens
    costUsd += estimateCostUsd(model, usage) ?? 0
  }

  function resolveProvider(tier: Tier): LLMProvider {
    return opts.providerOverride?.[tier] ?? buildProvider(settings, tier)
  }

  const ctx: SkillContext = {
    async llm(tier, req) {
      await checkBudget(meter, settings)
      const provider = resolveProvider(tier)
      const model = resolveTier(settings, tier).model
      const result = await withRetry(() => provider.complete(model, req))
      await meter.record({
        skill: opts.skill.name,
        runId,
        provider: provider.id,
        model: result.model,
        usage: result.usage,
      })
      accumulate(result.model, result.usage)
      return result
    },
    async llmStructured<T>(
      tier: Tier,
      req: Parameters<SkillContext["llm"]>[1],
      schema: z.ZodType<T>,
    ) {
      await checkBudget(meter, settings)
      const provider = resolveProvider(tier)
      const model = resolveTier(settings, tier).model
      const { value, usage } = await completeStructured(provider, model, req, schema)
      await meter.record({
        skill: opts.skill.name,
        runId,
        provider: provider.id,
        model,
        usage,
      })
      accumulate(model, usage)
      return value
    },
    log(msg) {
      logs.push(msg)
    },
  }

  let status: SkillRunResult<O>["status"] = "ok"
  let output: O | undefined
  let error: string | undefined

  try {
    output = await opts.skill.run(ctx, opts.input)
  } catch (e) {
    status = e instanceof BudgetExceededError ? "budget_exceeded" : "error"
    error = e instanceof Error ? e.message : String(e)
  }

  const run: SkillRunResult<O> = {
    runId,
    skill: opts.skill.name,
    status,
    output,
    error,
    usage: totals,
    costUsd,
    logs,
  }

  await opts.storage.write(`.scispark/runs/${runId}.json`, JSON.stringify(run, null, 2))

  return run
}
