import type { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, LLMUsage, ProviderId, Tier } from "../llm/types"
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
  /** Passed through to every `withRetry` call (both `ctx.llm` and `ctx.llmStructured`). Tests use this to shrink backoff delays. */
  retryOpts?: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> }
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

  async function meterAndContinue(entry: {
    provider: ProviderId
    model: string
    usage: LLMUsage
  }): Promise<void> {
    // Accumulate BEFORE awaiting meter.record: a metering (storage) failure must
    // not drop already-spent usage/cost from the run's totals, since the provider
    // call already happened and already cost real money.
    accumulate(entry.model, entry.usage)
    try {
      await meter.record({
        skill: opts.skill.name,
        runId,
        provider: entry.provider,
        model: entry.model,
        usage: entry.usage,
      })
    } catch (e) {
      logs.push(`metering failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const ctx: SkillContext = {
    async llm(tier, req) {
      await checkBudget(meter, settings)
      const provider = resolveProvider(tier)
      const model = resolveTier(settings, tier).model
      const result = await withRetry(() => provider.complete(model, req), opts.retryOpts)
      await meterAndContinue({ provider: provider.id, model: result.model, usage: result.usage })
      return result
    },
    async llmStructured<T>(
      tier: Tier,
      req: Parameters<SkillContext["llm"]>[1],
      schema: z.ZodType<T>,
    ) {
      await checkBudget(meter, settings)
      // NOTE: budget is checked once here, not inside completeStructured's internal
      // validation-retry loop — a structured call can therefore spend up to ~2x a
      // single call's cost before the next budget check catches it. Accepted
      // soft-overrun per the "summed usage recorded once" contract.
      const provider = resolveProvider(tier)
      const model = resolveTier(settings, tier).model
      // Wrap the provider in a retry-facade so transient/rate-limit errors during a
      // structured call are retried with backoff, same as ctx.llm — completeStructured's
      // own 2-attempt loop is for schema-validation retries only, not transient failures.
      const retryingProvider: LLMProvider = {
        id: provider.id,
        complete: (m, r) => withRetry(() => provider.complete(m, r), opts.retryOpts),
      }
      const { value, usage } = await completeStructured(retryingProvider, model, req, schema)
      await meterAndContinue({ provider: provider.id, model, usage })
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

  try {
    await opts.storage.write(`.scispark/runs/${runId}.json`, JSON.stringify(run, null, 2))
  } catch (e) {
    // A storage failure here must not turn a completed run into a rejected
    // promise: the caller still gets a coherent SkillRunResult (with whatever
    // output/usage/cost was already computed), just noted as unpersisted.
    logs.push(`run record persist failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  return run
}
