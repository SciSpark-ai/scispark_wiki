import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { createVault } from "../../vault/scaffold"
import { composePage } from "../../wiki/authoring"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { listReviews } from "../../wiki/review-queue"
import type { Frontmatter } from "../../vault/types"
import { runLintLlm } from "../run"

/**
 * LIVE end-to-end gate for M12 Task 14: a real deep-lint run (lintScreenSkill
 * fast-tier screen -> lintJudgeSkill strong-tier judge, src/lib/skills/lint.ts,
 * orchestrated by runLintLlm, src/lib/lint/run.ts) against a real LLM, over an
 * in-memory vault seeded with two related wiki pages carrying a PLANTED
 * CONTRADICTION about the same method's scaling behavior. Skipped unless all
 * three env vars are set:
 *
 *   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
 *   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
 *   LIVE_LLM_API_KEY=<key> \
 *   npx vitest run src/lib/lint/__tests__/live-lint.test.ts
 *
 * Makes real network calls to the LLM endpoint and spends real money (one
 * fast-tier screen call + one strong-tier judge call for a two-page vault) —
 * never runs in CI. Per the M9/M5 live gates' GMI structured-output note
 * (src/lib/spark/__tests__/live-spark.test.ts), the lint skills' schemas
 * (LintPairSchema, LintVerdictSchema) use only enums/arrays/strings, so no
 * extra numeric-constraint stripping is needed here; if the intermittent
 * whole-`output_config` flake appears, that's GMI backend-replica variance,
 * not a defect in this code — record it, don't chase it.
 */
const BASE_URL = process.env.LIVE_LLM_BASE_URL
const API_KEY = process.env.LIVE_LLM_API_KEY
const MODEL = process.env.LIVE_LLM_MODEL

const live = Boolean(BASE_URL && API_KEY && MODEL)
// One fast-tier screen call over a 2-page list, plus (if the screen surfaces
// the planted pair, which it should given the explicit related[]/sources[]
// adjacency) one strong-tier judge call reading both full bodies. Budget
// generously for the screen + a few judge calls, matching the brief.
const LIVE_TIMEOUT = 120_000

const TODAY = "2026-07-14"
const NOW = () => new Date(`${TODAY}T10:00:00.000Z`)

/**
 * Seeds a MemoryVaultStorage with two concept pages that plant a deliberate
 * contradiction: page A claims Method X's runtime scales linearly with
 * sequence length, page B (linking back to A and sharing the same source)
 * claims the opposite — quadratic scaling — for the same setup. Both pages
 * are written via `composePage` (the real production page-authoring
 * serializer, src/lib/wiki/authoring.ts) with a full, schema-valid
 * frontmatter contract so they parse and link cleanly, giving
 * lintScreenSkill's related/shared-source adjacency signal a real pair to
 * surface (mirrors live-spark.test.ts's seedVault / run.test.ts's planted
 * linear-vs-quadratic contradiction fixture).
 */
async function seedVault(storage: MemoryVaultStorage): Promise<void> {
  await createVault(storage, { purpose: "Track research on Method X's scaling behavior.", today: TODAY })

  const sharedSource = "arxiv:2401.00001"

  const frontmatterFor = (title: string, related: string[]): Frontmatter => ({
    type: "concept",
    title,
    created: TODAY,
    updated: TODAY,
    tags: ["method-x", "scaling"],
    related,
    sources: [sharedSource],
  })

  await storage.write(
    "wiki/concepts/method-x-scaling-linear.md",
    composePage({
      path: "wiki/concepts/method-x-scaling-linear.md",
      frontmatter: frontmatterFor("Method X Scaling (Linear Claim)", ["method-x-scaling-quadratic"]),
      body:
        "# Method X Scaling (Linear Claim)\n\n" +
        "Method X, run on sequence lengths from 1k to 32k tokens on the same benchmark " +
        "hardware and configuration, scales **linearly** (O(n)) with sequence length: " +
        "going from 1k to 32k tokens (a 32x increase) increases wall-clock time by " +
        "roughly 32x, matching the linear complexity of Method X's attention mechanism. " +
        "See [[method-x-scaling-quadratic]] for a later profiling study.\n",
    }),
  )

  await storage.write(
    "wiki/concepts/method-x-scaling-quadratic.md",
    composePage({
      path: "wiki/concepts/method-x-scaling-quadratic.md",
      frontmatter: frontmatterFor("Method X Scaling (Quadratic Claim)", ["method-x-scaling-linear"]),
      body:
        "# Method X Scaling (Quadratic Claim)\n\n" +
        "A follow-up profiling study of Method X, using the same sequence-length range " +
        "(1k to 32k tokens) and the same benchmark hardware and configuration as the " +
        "earlier report [[method-x-scaling-linear]], found runtime instead scales " +
        "**quadratically** (O(n^2)) with sequence length: going from 1k to 32k tokens " +
        "(32x) increases wall-clock time by roughly 1024x (32^2), directly contradicting " +
        "the earlier linear-scaling claim for the same method and setup.\n",
    }),
  )
}

function liveSettings() {
  return {
    ...DEFAULT_SETTINGS,
    keys: { openai: API_KEY as string },
    baseUrls: { openai: BASE_URL as string },
    tierModels: {
      fast: { provider: "openai" as const, model: MODEL as string },
      strong: { provider: "openai" as const, model: MODEL as string },
    },
    dailyBudgetUsd: 10,
  }
}

describe.skipIf(!live)("LIVE lint gate (deep lint vs planted contradiction)", () => {
  it(
    "runLintLlm against a real LLM: finds the planted contradiction, writes a review item, logs cost",
    { timeout: LIVE_TIMEOUT },
    async () => {
      const storage = new MemoryVaultStorage()
      await seedVault(storage)

      const result = await runLintLlm(storage, {
        settings: liveSettings(),
        now: NOW,
      })

      console.log(`[live-lint] findings: ${JSON.stringify(result.findings, null, 2)}`)
      console.log(`[live-lint] reviewIds: ${JSON.stringify(result.reviewIds)}`)
      console.log(`[live-lint] costUsd: $${(result.costUsd?.toFixed(4) ?? "unknown")}`)

      expect(result.findings.length).toBeGreaterThanOrEqual(1)

      const flaggedKinds = result.findings.map((f) => f.lintKind)
      const flaggedPlantedPair = result.findings.some((f) =>
        (f.lintKind === "contradiction" || f.lintKind === "stale-claim") &&
        f.pages.includes("wiki/concepts/method-x-scaling-linear") &&
        f.pages.includes("wiki/concepts/method-x-scaling-quadratic"),
      )
      console.log(`[live-lint] flagged lintKinds: ${JSON.stringify(flaggedKinds)}`)
      expect(flaggedPlantedPair).toBe(true)

      expect(result.reviewIds.length).toBeGreaterThanOrEqual(1)
      const reviews = await listReviews(storage)
      expect(reviews.length).toBeGreaterThanOrEqual(1)
      const sample = reviews.find((r) => r.lintKind === "contradiction" || r.lintKind === "stale-claim")
      expect(sample).toBeDefined()
      console.log(`[live-lint] sample review item: ${JSON.stringify(sample, null, 2)}`)

      expect(result.costUsd).toBeLessThan(0.3)
    },
  )
})

// Always-on guard so the file is never an empty suite when env is unset.
describe("live lint gate wiring", () => {
  it("skips cleanly without LIVE_LLM_* env", () => {
    expect(typeof live).toBe("boolean")
  })
})
