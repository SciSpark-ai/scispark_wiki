import { z } from "zod"
import { defineSkill } from "./types"

/**
 * Skill definitions backing the `/debug/llm` manual-verification page (M11
 * Task 10). These used to live inline in `src/app/debug/llm/page.tsx` and run
 * client-side via a direct `runSkill` import — the browser-purity gate now
 * forbids that (client code never runs skills/holds keys), so they moved here
 * and are invoked by `POST /api/skills/debug/ping` instead. Trivial on
 * purpose: this page exists only to manually verify the harness plumbing
 * (settings -> provider -> runner -> metering -> budget), not to demonstrate
 * a real feature.
 */

export const pingSkill = defineSkill({
  name: "debug-ping",
  version: "1",
  run: async (ctx) =>
    (
      await ctx.llm("fast", {
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
        maxTokens: 32,
      })
    ).text,
})

export const structuredSchema = z.object({
  answer: z.string(),
  confidence: z.number(),
})

export type DebugStructuredOutput = z.infer<typeof structuredSchema>

export const structuredSkill = defineSkill({
  name: "debug-structured",
  version: "1",
  run: async (ctx) =>
    ctx.llmStructured(
      "fast",
      {
        messages: [
          {
            role: "user",
            content:
              "Give a JSON object with answer (a short string) and confidence (0-1 number) for: is water wet?",
          },
        ],
      },
      structuredSchema,
    ),
})
