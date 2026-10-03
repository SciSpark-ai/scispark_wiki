import { afterEach, expect, it, vi } from "vitest"
import { resolve } from "node:path"
import { z } from "zod"
import { DEFAULT_ENGINES } from "../contracts"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { openVault } from "../../vault/scaffold"
import { DEFAULT_SETTINGS, saveSettings, buildProvider } from "../../llm/settings"
import { createReview, loadReview, updateReview } from "../../review/store"
import { actOnReview, reviewSnapshot, waitForReview } from "../../review/coordinator"
import { reviewComplete, reviewSpend, acknowledgeReviewCharge } from "../../review/budget"
import type { PaperRecord } from "../../papers/types"

afterEach(() => vi.unstubAllEnvs())
for (const engine of ["codex", "claude-code"] as const) {
  async function setup() {
    vi.stubEnv("SCISPARK_CODEX_PATH", resolve("e2e/fixtures/engines/codex.mjs"))
    vi.stubEnv("SCISPARK_CLAUDE_PATH", resolve("e2e/fixtures/engines/claude.mjs"))
    const storage = new MemoryVaultStorage(); await openVault(storage)
    const settings = { ...DEFAULT_SETTINGS, keys: {}, engines: { ...DEFAULT_ENGINES, kind: engine }, dailyBudgetUsd: 0 }
    await saveSettings(storage, settings)
    const run = await createReview(storage, { sessionId: "engine-review", operationId: engine, question: "Compare adult decoding methods", sources: ["openalex"] })
    return { storage, settings, run }
  }
  it(`${engine}: completes the real review pipeline with no key or token prices`, async () => {
    const { storage, run } = await setup()
    const papers: PaperRecord[] = [
      { ids: { doi: "10.1000/positive" }, title: "Adult decoding positive fixture", abstract: "Among 30 adults, decoding improved with the tested method. Pediatric outcomes were not studied.", authors: [{ name: "A Fixture" }], fields: [], source: "openalex" },
      { ids: { doi: "10.1000/null" }, title: "Adult decoding null fixture", abstract: "Among 20 adults, decoding did not improve with the tested method.", authors: [{ name: "B Fixture" }], fields: [], source: "openalex" },
    ]
    expect(run.brief.model.engine).toBe(engine); expect(run.brief.model.rates).toBeNull()
    await actOnReview(storage, run.id, { action: "approve", revision: run.revision }, {
      search: async (_source, query) => query.startsWith("null") ? [papers[1]] : [papers[0]],
      fetch: async () => new Response("unavailable", { status: 403 }),
    })
    await waitForReview(storage, run.id)
    const final = await loadReview(storage, run.id)
    expect(final.error).toBeNull()
    expect(final.status).toBe("completed")
    expect(final.versions[0].markdown).toContain("did not improve")
    expect(final.versions[0].verification).toBe("checked-draft")
    const spend = await reviewSpend(storage, run.id)
    expect(spend.engineCalls).toBeGreaterThan(0)
    expect(spend.spentUsd).toBe(0)
    expect(spend.uncertain).toBe(false)
  }, 30_000)
  it(`${engine}: persists uncertain calls, requires acknowledgement and replays settled results`, async () => {
    const { storage, settings, run } = await setup()
    const provider = buildProvider(settings, "strong")
    const spy = vi.spyOn(provider, "complete")
    const invoke = (prompt: string) => reviewComplete(storage, run.id, run.brief, "fixture-step", prompt, z.object({ message: z.string() }), 256, async () => {}, provider)
    await expect(invoke("FIXTURE_ERROR")).rejects.toThrow()
    expect((await reviewSpend(storage, run.id)).uncertain).toBe(true)
    await expect(invoke("ready")).rejects.toThrow("Acknowledge")
    expect(spy).toHaveBeenCalledTimes(1)
    await acknowledgeReviewCharge(storage, run.id)
    expect((await reviewSpend(storage, run.id)).uncertain).toBe(false)
    await expect(invoke("ready")).resolves.toEqual({ message: "ready" })
    await expect(invoke("ready")).resolves.toEqual({ message: "ready" })
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it(`${engine}: can approve an amended brief after acknowledging the existing uncertain attempt`, async () => {
    const { storage, settings, run } = await setup()
    await expect(reviewComplete(storage, run.id, run.brief, "old-attempt", "FIXTURE_ERROR", z.object({ message: z.string() }), 256, async () => {}, buildProvider(settings, "strong"))).rejects.toThrow()
    const paused = await updateReview(storage, run.id, r => { r.status = "paused"; r.approvedRevision = 0 })
    await actOnReview(storage, run.id, { action: "amend", revision: paused.revision, question: run.brief.question, scope: run.brief.scope, allowanceUsd: run.brief.allowanceUsd, usePersonalContext: false, rates: null })
    const amended = await loadReview(storage, run.id)
    await expect(actOnReview(storage, run.id, { action: "approve", revision: amended.revision })).rejects.toThrow("uncertain")
    await actOnReview(storage, run.id, { action: "approve", revision: amended.revision, acknowledgeUncertainCharge: true }, { search: async () => [] })
    await waitForReview(storage, run.id)
    const attempts = JSON.parse((await storage.read(`.scispark/reviews/${run.id}/engine-attempts.json`))!)
    expect(attempts[0].state).toBe("acknowledged")
    expect((await reviewSpend(storage, run.id)).uncertain).toBe(false)
  })
  if (engine === "codex") it("rejects an unavailable Codex model before reserving a review attempt", async () => {
    const { storage, settings } = await setup()
    await saveSettings(storage, { ...settings, engines: { ...settings.engines, models: { ...settings.engines.models, codex: { ...settings.engines.models.codex, strong: "gpt-6-astra" } } } })
    const run = await createReview(storage, { sessionId: "unavailable-model", operationId: "unavailable-model", question: "Compare adult decoding methods", sources: ["openalex"] })
    await actOnReview(storage, run.id, { action: "approve", revision: run.revision })
    await waitForReview(storage, run.id)
    expect((await loadReview(storage, run.id)).error).toContain("does not list gpt-6-astra")
    expect(await reviewSpend(storage, run.id)).toMatchObject({ engineCalls: 0, uncertain: false })
    const before = await storage.read(`.scispark/reviews/${run.id}/run.json`)
    expect(await reviewSnapshot(storage, run.id)).toHaveProperty("modelError", expect.stringContaining("does not list gpt-6-astra"))
    expect(await storage.read(`.scispark/reviews/${run.id}/run.json`)).toBe(before)
    expect(await reviewSpend(storage, run.id)).toMatchObject({ engineCalls: 0, uncertain: false })
  })
}
