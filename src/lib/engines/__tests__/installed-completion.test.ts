import { expect, test } from "vitest"
import { z } from "zod"
import { DEFAULT_ENGINES, type LocalEngine } from "../contracts"
import { LocalEngineProvider } from "../local-provider"
import { completeStructured } from "../../llm/structured"

// Explicit live gate: synthetic context only, one completion, no automatic retry.
// SCISPARK_ENGINE_SMOKE=codex|claude-code SCISPARK_ENGINE_MODEL=<id>
const engine = process.env.SCISPARK_ENGINE_SMOKE
test.skipIf(engine !== "codex" && engine !== "claude-code")("installed engine returns a validated research response", async () => {
  const model = process.env.SCISPARK_ENGINE_MODEL
  if (!model) throw new Error("Set SCISPARK_ENGINE_MODEL explicitly for this live gate")
  const provider = new LocalEngineProvider(engine as LocalEngine, { ...DEFAULT_ENGINES, timeoutSeconds: 60 })
  const schema = z.object({ message: z.literal("ready"), answer: z.literal(7) }).strict()
  const result = await completeStructured(provider, model, {
    messages: [{ role: "user", content: "Synthetic integration check: study A contains 3 fictional papers and study B contains 4. Return message ready and their total as answer. Do not use tools." }],
    maxTokens: 512,
    reasoningEffort: "low",
  }, schema)
  expect(result.value).toEqual({ message: "ready", answer: 7 })
  expect(result.usage.reported).toBe(true)
  expect(result.usage.billingMode).toBe("subscription")
  expect(result.usage.outputTokens).toBeGreaterThan(0)
}, 90_000)
