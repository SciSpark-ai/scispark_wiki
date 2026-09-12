import { afterEach, expect, it, vi } from "vitest"
import { resolve } from "node:path"
import { z } from "zod"
import { DEFAULT_ENGINES } from "../contracts"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { openVault } from "../../vault/scaffold"
import { DEFAULT_SETTINGS, saveSettings, buildProvider } from "../../llm/settings"
import { createReview, loadReview } from "../../review/store"
import { actOnReview, waitForReview } from "../../review/coordinator"
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
}
