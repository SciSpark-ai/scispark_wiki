import { expect, test } from "vitest"
import { DEFAULT_ENGINES, type LocalEngine } from "../contracts"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { openVault } from "../../vault/scaffold"
import { DEFAULT_SETTINGS, saveSettings } from "../../llm/settings"
import { createReview } from "../../review/store"
import { defineReviewRequirements } from "../../review/coverage"
import { reviewComplete, reviewSpend } from "../../review/budget"
import type { ReviewCompletion } from "../../review/scholarqa"

// One real planning call through the same budget/provider path as a review.
// Repeating the stage must reuse the settled result without a second request.
const engine = process.env.SCISPARK_ENGINE_REVIEW_SMOKE
test.skipIf(engine !== "codex" && engine !== "claude-code")("installed engine plans a review and reuses the settled result", async () => {
  const model = process.env.SCISPARK_ENGINE_MODEL
  if (!model) throw new Error("Set SCISPARK_ENGINE_MODEL explicitly for this live gate")
  const kind = engine as LocalEngine
  const storage = new MemoryVaultStorage()
  await openVault(storage)
  await saveSettings(storage, { ...DEFAULT_SETTINGS, keys: {}, engines: {
    ...DEFAULT_ENGINES, kind, timeoutSeconds: 90,
    models: { ...DEFAULT_ENGINES.models, [kind]: { strong: model, fast: model } },
  } })
  const question = "Compare linear encoding and decoding methods for adult EEG speech tracking, including inputs, outputs and limitations."
  const run = await createReview(storage, { sessionId: "installed-engine-check", operationId: "planning-check", question, sources: ["openalex"] })
  const complete: ReviewCompletion = (step, prompt, schema, tokens) =>
    reviewComplete(storage, run.id, run.brief, step, prompt, schema, Math.max(tokens, 4096), async () => {})
  const requirements = await defineReviewRequirements(question, complete)
  expect(requirements.length).toBeGreaterThan(0)
  expect(await defineReviewRequirements(question, complete)).toEqual(requirements)
  expect(await reviewSpend(storage, run.id)).toMatchObject({ engineCalls: 1, uncertain: false, spentUsd: 0 })
}, 120_000)
