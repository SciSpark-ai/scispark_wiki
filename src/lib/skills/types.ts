import type { z } from "zod"
import type { LLMRequest, LLMResult, LLMUsage, Tier } from "../llm/types"

/**
 * The interface a running skill uses to talk to the LLM harness. Skills never touch
 * providers, settings, or metering directly — the runner wires all of that into `llm`/
 * `llmStructured` so every call is budget-checked, retried, and metered uniformly.
 */
export interface SkillContext {
  llm(tier: Tier, req: Omit<LLMRequest, "jsonSchema" | "schemaName">): Promise<LLMResult>
  llmStructured<T>(
    tier: Tier,
    req: Omit<LLMRequest, "jsonSchema" | "schemaName">,
    schema: z.ZodType<T>,
  ): Promise<T>
  log(msg: string): void
}

export interface SkillDefinition<I, O> {
  name: string
  version: string
  run(ctx: SkillContext, input: I): Promise<O>
}

/** Identity function — exists purely so callers get input/output type inference for free. */
export function defineSkill<I, O>(def: SkillDefinition<I, O>): SkillDefinition<I, O> {
  return def
}

export interface SkillRunResult<O> {
  runId: string
  skill: string
  status: "ok" | "error" | "budget_exceeded"
  output?: O
  error?: string
  usage: LLMUsage
  costUsd: number
  logs: string[]
}
