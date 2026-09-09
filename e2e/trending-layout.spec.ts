import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION } from "../src/lib/trending/cache"
import { canonicalAnchor } from "../src/lib/trending/openalex-fields"
import type { TrendingBoard } from "../src/lib/trending/types"
import type { PaperRecord } from "../src/lib/papers/types"

test("Trending has readable scoped navigation, comparisons and papers on desktop and phone", async ({ page, request }, testInfo) => {
  const path = process.env.SCISPARK_E2E_VAULT_PATH
  if (!path) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(path)
  const before = await (await request.get("/api/settings")).json()
  const beforeBoard = await storage.read(DASHBOARD_CACHE_PATH)
  const anchors = [
    { ...canonicalAnchor("28")!, subfieldIds: ["https://openalex.org/subfields/2805", "https://openalex.org/subfields/2804"] },
    { ...canonicalAnchor("17")!, subfieldIds: ["https://openalex.org/subfields/1702", "https://openalex.org/subfields/1709"] },
    canonicalAnchor("27")!,
  ]
  const paper = (title: string, doi: string): PaperRecord => ({ ids: { doi }, title, source: "openalex", fields: [], authors: [{ name: "Fixture researcher" }], year: 2026 })
  const papers = [
    paper("Electrophysiological indices of hierarchical speech processing reflect the comprehension of speech in noise", "10.1234/trending-layout-speech"),
    paper("Neural representations of auditory attention during natural conversations", "10.1234/trending-layout-attention"),
    paper("A reproducible framework for evaluating language models in scientific discovery", "10.1234/trending-layout-models"),
  ]
  const board: TrendingBoard = {
    version: TRENDING_BOARD_VERSION, generatedAt: new Date().toISOString(), anchors,
    overview: { totalRecent: 43172, topTopicLabel: "Metaheuristic Optimization Algorithms Research", topTopicGrowth: 10.54, relevantCount: 2 },
    topics: [
      ["Metaheuristic Optimization Algorithms Research", "Computer Science", 10.54, 254, 22, 0.1154, 0.01, false],
      ["Neural Networks and Applications", "Computer Science", 5.7, 187, 28, 0.067, 0.01, true],
      ["Auditory Attention and Speech Processing in Challenging Listening Conditions", "Neuroscience", 0.82, 134, 184, 0.0182, 0.01, true],
      ["Bayesian Modeling and Causal Inference", "Computer Science", 2.05, 91, 30, 0.0305, 0.01, false],
      ["Neural Speech Tracking in Naturalistic Environments", "Neuroscience", null, 31, 2, 0.004, 0, false],
    ].map(([label, discipline, growth, recentCount, priorCount, recentShare, priorShare, relevant], i) => ({
      key: `layout-${i}`, label: label as string, discipline: discipline as string, growth: growth as number | null,
      recentCount: recentCount as number, priorCount: priorCount as number, recentShare: recentShare as number,
      priorShare: priorShare as number, relevant: relevant as boolean,
      papers: [{ record: papers[i % papers.length], wikiPageId: null }],
      why: i === 4 ? null : "These papers examine how experimental methods and computational models are being applied within this research topic.",
    })),
    breakouts: papers.map((record, i) => ({ record, citationCount: 128 - i * 27, wikiPageId: null })),
    crossDisciplineNote: null,
  }
  let refreshes = 0
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/api/skills/trending/refresh", async (route) => {
    refreshes++
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", message: "Fixture refresh failure" }) + "\n" })
  })
  try {
    expect((await request.put("/api/settings", { data: { trending: { fields: [], cadence: "weekly", anchors, anchorsOverridden: true } } })).ok()).toBe(true)
    await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify(board))
    for (const viewport of [
      { name: "desktop-light", width: 1440, height: 1000, theme: "light" },
      { name: "desktop-dark", width: 1440, height: 1000, theme: "dark" },
      { name: "phone-light", width: 390, height: 844, theme: "light" },
      { name: "phone-dark", width: 390, height: 844, theme: "dark" },
    ]) {
      await request.put("/api/settings", { data: { ui: { theme: viewport.theme } } })
      await page.setViewportSize(viewport)
      await page.goto("/trending")
      const filters = page.getByRole("group", { name: "Filter topics by field" })
      const topics = page.getByRole("region", { name: "Topic activity" })
      await expect(filters.getByRole("button", { name: "All fields", exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText("43,172", { exact: true })).toBeVisible()
      await expect(page.getByText(/Compared with/)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const sentence of ["Growth tracks publication share.", "It does not measure paper-count growth."]) {
        expect(await page.getByText(sentence, { exact: true }).evaluate((element) => {
          const range = document.createRange(); range.selectNodeContents(element)
          return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size
        })).toBe(1)
      }
      await page.screenshot({ path: testInfo.outputPath(`trending-${viewport.name}.png`) })
      if (viewport.width < 768) {
        await topics.getByRole("button", { name: /Metaheuristic/ }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath(`trending-list-${viewport.name}.png`) })
      }

      await filters.getByRole("button", { name: "Neuroscience", exact: true }).focus()
      await page.keyboard.press("Enter")
      await expect(filters.getByRole("button", { name: "Neuroscience", exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(topics.getByRole("button", { name: /Metaheuristic/ })).toHaveCount(0)
      await expect(topics.getByRole("button", { name: /Auditory Attention/ })).toBeVisible()
      await page.getByText("Included subfields", { exact: true }).click()
      await expect(page.getByText("Cognitive Neuroscience", { exact: true })).toBeVisible()
      const auditory = topics.getByRole("button", { name: /Auditory Attention/ })
      await auditory.focus(); await page.keyboard.press("Enter")
      await expect(auditory).toHaveAttribute("aria-expanded", "true")
      await expect(topics.getByText("Share of publications:", { exact: true })).toBeVisible()
      await expect(topics.getByRole("link", { name: papers[2].title, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const detailsId = await auditory.getAttribute("aria-controls")
      await page.locator(`[id="${detailsId}"]`).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`trending-detail-${viewport.name}.png`) })

      await filters.getByRole("button", { name: "Medicine", exact: true }).click()
      await expect(topics.getByRole("status")).toContainText("It does not mean this field has no activity.")
      // Sidebar retains its all-fields scope even when the topic list is filtered.
      await expect(page.getByRole("complementary", { name: "Highly cited papers across all fields" })).toContainText(papers[0].title)
      await topics.getByRole("button", { name: "Show all topics", exact: true }).click()
      await expect(topics.getByRole("button", { name: /Metaheuristic/ })).toBeVisible()
      expect(refreshes).toBe(0)
    }
    await page.getByRole("button", { name: "Edit fields", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible()
    expect((await (await request.get("/api/settings")).json()).trending.anchors).toEqual(anchors)
    expect(errors).toEqual([])
  } finally {
    if (beforeBoard === null) await storage.delete(DASHBOARD_CACHE_PATH)
    else await storage.write(DASHBOARD_CACHE_PATH, beforeBoard)
    await request.put("/api/settings", { data: { trending: before.trending, ui: { theme: before.ui.theme } } })
  }
})
