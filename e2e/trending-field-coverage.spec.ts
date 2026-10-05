import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { runTrendingBoard } from "../src/lib/trending/dashboard"
import { DASHBOARD_CACHE_PATH } from "../src/lib/trending/cache"
import { MockProvider } from "../src/lib/llm/mock-provider"

// The real deterministic pipeline, isolated source data and fixture model.
// Reproduces the reported case: all combined top-ten slots belong to CS.
test("Neuroscience retains its own ranked topics outside the combined top ten", async ({ page, request }, info) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const before = await storage.read(DASHBOARD_CACHE_PATH)
  const settings = (await (await request.get("/api/settings")).json()).trending
  const anchors = [{ id: "https://openalex.org/fields/17", label: "Computer Science" }, { id: "https://openalex.org/fields/28", label: "Neuroscience" }]
  let refreshes = 0
  await page.route("**/api/skills/trending/refresh", async route => {
    refreshes++
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", message: "Unexpected refresh" }) + "\n" })
  })
  try {
    await request.put("/api/settings", { data: { trending: { fields: [], cadence: "weekly", anchors, anchorsOverridden: true } } })
    const result = { topics: Array.from({ length: 10 }, (_, i) => ({ key: `topic-${i + 1}`, why: "Fixture explanation." })) }
    const provider = new MockProvider([0, 1].map(() => ({ text: JSON.stringify(result), json: result, usage: { inputTokens: 1, outputTokens: 1 }, model: "m", provider: "openai", stopReason: "end_turn" })))
    const board = await runTrendingBoard(storage, {
      fields: [],
      fieldGroupFn: async () => [],
      topicGroupFn: async ({ fieldId }) => Array.from({ length: 25 }, (_, i) => ({
        key: `T${fieldId?.endsWith("17") ? "cs" : "neuro"}${i}`,
        label: `${fieldId?.endsWith("17") ? "Computing" : "Neural processing"} topic ${i + 1}`,
        count: (fieldId?.endsWith("17") ? 500 : 20) + i,
      })),
      countFn: async ({ topicId }) => topicId ? 10 : 20_000,
      topWorksFn: async () => [],
      settings: { keys: { openai: "fixture" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://fixture.invalid/v1" } },
      providerOverride: { strong: provider },
    })
    expect(board.topics).toHaveLength(20)
    expect(board.topics.slice(0, 10).every(topic => topic.discipline === "Computer Science")).toBe(true)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto("/trending")
      const filters = page.getByRole("group", { name: "Filter topics by field" })
      const topics = page.getByRole("region", { name: "Topic activity" })
      await expect(topics.getByRole("button", { name: /Computing topic/ })).toHaveCount(10)
      await expect(topics.getByRole("button", { name: /Neural processing topic/ })).toHaveCount(0)
      await filters.getByRole("button", { name: "Neuroscience", exact: true }).click()
      await expect(topics.getByRole("button", { name: /Neural processing topic/ })).toHaveCount(10)
      await expect(topics.getByRole("button", { name: /Computing topic/ })).toHaveCount(0)
      await expect(topics.getByText("10 topics in this selection", { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`neuroscience-${width}.png`) })
    }
    expect(refreshes).toBe(0)
  } finally {
    if (before === null) await storage.delete(DASHBOARD_CACHE_PATH)
    else await storage.write(DASHBOARD_CACHE_PATH, before)
    await request.put("/api/settings", { data: { trending: settings } })
  }
})
