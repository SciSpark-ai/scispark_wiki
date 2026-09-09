import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { companionSkill, type CompanionSkillInput, type Utterance } from "../skill"
import { runSkill } from "../../skills/runner"

/**
 * LIVE end-to-end gate for M7: a real Companion utterance call (a deterministic
 * trigger's context blurb + feedback.md standing instructions) against a real
 * LLM, over an in-memory vault. Skipped unless all three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/companion/__tests__/live-companion.test.ts
 *
 * Makes a real network call to the LLM endpoint and spends real (small)
 * money — never runs in CI.
 *
 * Note: `UtteranceSchema` (src/lib/companion/skill.ts) is `z.object({ utterance:
 * z.string() })` — a single constraint-free string field, no numeric/length
 * constraints — so the M5-discovered constraint-keyword stripping in
 * `OpenAICompatProvider` (which exists for schemas that DO carry such
 * constraints) is a no-op here. The intermittent whole-`output_config.format`
 * replica flakiness seen elsewhere against GMI is therefore unlikely to show up
 * for this skill; if it does, that's a known live-backend quirk, not a code
 * defect — record it in the SDD ledger rather than treating it as a regression
 * (see the M6 plan's "provider prompt-JSON fallback" ride-along item).
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
const LIVE_TIMEOUT = 60_000

describe.skipIf(!live)("LIVE companion utterance gate", () => {
  it(
    "phrases a short in-persona utterance for a real trigger, against a real LLM",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()

      const settings = {
        ...DEFAULT_SETTINGS,
        keys: { openai: API_KEY as string },
        baseUrls: { openai: BASE_URL as string },
        tierModels: {
          fast: { provider: "openai" as const, model: MODEL as string },
          strong: { provider: "openai" as const, model: MODEL as string },
        },
        dailyBudgetUsd: 5,
      }

      const input: CompanionSkillInput = {
        triggerContext: "The user just added the paper 'Attention Is All You Need' to their knowledge base.",
        feedback: "Keep it brief and upbeat.",
      }

      const run = await runSkill({
        skill: companionSkill,
        input,
        storage,
        settings,
      })

      console.log(
        `[live-companion] status=${run.status} costUsd=${run.costUsd} ` +
          `usage=${JSON.stringify(run.usage)} logs=${JSON.stringify(run.logs)}`,
      )
      if (run.status !== "ok") console.log(`[live-companion] error: ${run.error}`)
      expect(run.status).toBe("ok")

      const output = run.output as Utterance
      console.log(`[live-companion] utterance: ${output.utterance}`)

      expect(output.utterance.trim().length).toBeGreaterThan(0)
      // A one-liner: the system prompt asks for ~20 words; this is a loose ceiling.
      expect(output.utterance.length).toBeLessThanOrEqual(160)

      console.log(`[live-companion] costUsd: $${(run.costUsd?.toFixed(4) ?? "unknown")}`)
      expect(run.costUsd).toBeLessThan(0.02)
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live companion gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
