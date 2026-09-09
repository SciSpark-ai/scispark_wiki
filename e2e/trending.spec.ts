import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION } from "../src/lib/trending/cache"
import type { TrendingBoard } from "../src/lib/trending/types"

test("Trending cache opens a paper and its cached digest, supports reading Ask, and survives refresh failure", async ({ page, request }, testInfo) => {
  const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH
  if (!vaultPath) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(vaultPath)
  const digestPath = ".scispark/digests/trending-boundary-fixture.json"
  const beforeBoard = await storage.read(DASHBOARD_CACHE_PATH)
  const beforeDigest = await storage.read(digestPath)
  const settings = await (await request.get("/api/settings")).json()
  const errors: string[] = []
  let refreshes = 0
  page.on("pageerror", (error) => errors.push(error.message))
  // A failed refresh must preserve the cached board. No public literature or
  // paid provider is contacted; reading Ask uses the fixture's local provider.
  await page.route("**/api/skills/trending/refresh", async (route) => {
    refreshes++
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", message: "Temporary test source outage" }) + "\n" })
  })
  const anchor = { id: "https://openalex.org/fields/17", label: "Computer Science" }
  const paper = {
    ids: {}, title: "Trending boundary fixture", authors: [{ name: "Test Researcher" }],
    abstract: "A disposable paper for testing cached literature and grounded reading.",
    fields: ["Computer Science"], year: 2026, venue: "Local test proceedings", source: "s2" as const,
  }
  const board: TrendingBoard = {
    version: TRENDING_BOARD_VERSION, generatedAt: new Date().toISOString(), anchors: [anchor],
    overview: { totalRecent: 128, topTopicLabel: "Grounded reading", topTopicGrowth: 0.5, relevantCount: 1 },
    topics: [{ key: "grounded-reading", label: "Grounded reading", discipline: anchor.label, growth: 0.5,
      recentCount: 30, priorCount: 20, recentShare: 0.3, priorShare: 0.2, relevant: true,
      why: "Fixture summary of the retrieved topic.", papers: [{ record: paper, wikiPageId: null }] }],
    breakouts: [], crossDisciplineNote: null,
  }
  try {
    expect((await request.put("/api/settings", { data: {
      ui: { theme: "light" },
      trending: { fields: [{ slug: "computer-science", label: anchor.label }], cadence: "weekly", anchors: [anchor], anchorsOverridden: true },
    } })).ok()).toBe(true)
    await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify(board))
    await storage.write(digestPath, JSON.stringify({
      summary: "The cached digest remains readable without regenerating it.", laySummary: "A local test paper.",
      keyPoints: ["Cached content stays available."], methods: "Fixture-based browser testing.",
      limitations: "Not research evidence.", fieldContext: "Software verification.",
    }))
    await page.goto("/trending")
    await expect(page.getByRole("heading", { name: "Trending in your fields" })).toBeVisible()
    const topic = page.getByRole("button", { name: /Grounded reading/ })
    await expect(topic).toBeVisible()
    expect(refreshes).toBe(0)
    await topic.click()
    await expect(page.getByText("Fixture summary of the retrieved topic.")).toBeVisible()
    await page.getByRole("link", { name: paper.title, exact: true }).click()
    await expect(page).toHaveURL(/\/paper\/trending-boundary-fixture$/)
    const title = page.getByRole("heading", { name: paper.title, exact: true })
    await expect(title).toBeVisible()
    await expect(page.getByText("The cached digest remains readable without regenerating it.", { exact: true })).toBeVisible()
    await title.click({ clickCount: 3 })
    await page.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Ask", exact: true }).click()
    const panel = page.getByRole("dialog", { name: "Ask panel" })
    await expect(panel.getByText("The disposable paper supports this project-scoped answer.", { exact: true })).toBeVisible()
    await page.goto("/trending")
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await expect(page.getByText("Temporary test source outage")).toBeVisible()
    await expect(topic).toBeVisible()
    expect(refreshes).toBe(1)
    await page.reload()
    await expect(topic).toBeVisible()
    expect(refreshes).toBe(1)
    expect(errors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath("trending-browser-boundary.png"), fullPage: true })
  } finally {
    if (beforeBoard === null) await storage.delete(DASHBOARD_CACHE_PATH)
    else await storage.write(DASHBOARD_CACHE_PATH, beforeBoard)
    if (beforeDigest === null) await storage.delete(digestPath)
    else await storage.write(digestPath, beforeDigest)
    await request.put("/api/settings", { data: { trending: settings.trending, ui: { theme: settings.ui.theme } } })
  }
})
