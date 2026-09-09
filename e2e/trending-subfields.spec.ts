import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION } from "../src/lib/trending/cache"
import { canonicalAnchor } from "../src/lib/trending/openalex-fields"
import type { TrendingBoard } from "../src/lib/trending/types"

test("Trending starts with fields and optionally narrows to that field's subfields", async ({ page, request }, testInfo) => {
  const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH
  if (!vaultPath) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(vaultPath)
  const beforeSettings = await (await request.get("/api/settings")).json()
  const beforeBoard = await storage.read(DASHBOARD_CACHE_PATH)
  const neuro = canonicalAnchor("28")!
  const cognitive = "https://openalex.org/subfields/2805"
  const sensory = "https://openalex.org/subfields/2809"
  const selected = { ...neuro, subfieldIds: [cognitive, sensory] }
  const errors: string[] = []
  let refreshes = 0
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/api/skills/trending/refresh", async (route) => {
    refreshes++
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({
      type: "error", message: "Fixture subfield refresh requested",
    }) + "\n" })
  })
  try {
    const initial = { fields: [], cadence: "weekly", anchors: [], anchorsOverridden: false }
    expect((await request.put("/api/settings", { data: { trending: initial } })).ok()).toBe(true)
    await page.goto("/settings?section=trending")
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
    const save = dialog.getByRole("button", { name: "Save", exact: true })
    const neuroCheckbox = dialog.getByRole("checkbox", { name: "Neuroscience", exact: true })
    const summary = dialog.locator("summary").filter({ hasText: "Neuroscience" })
    await expect(dialog.getByRole("checkbox")).toHaveCount(26)
    await expect(dialog.locator("summary")).toHaveCount(0)
    await neuroCheckbox.check()
    await expect(summary).toContainText("Entire field included.")
    await expect(dialog.getByRole("checkbox", { name: "Cognitive Neuroscience", exact: true })).toHaveCount(0)
    await summary.focus()
    await summary.press("Enter")
    const children = dialog.getByRole("group", { name: "Neuroscience subfields", exact: true })
    await expect(children.getByRole("checkbox")).toHaveCount(8)
    await expect(dialog.getByRole("checkbox", { name: "Health Informatics", exact: true })).toHaveCount(0)
    await children.getByRole("checkbox", { name: "Cognitive Neuroscience", exact: true }).check()
    await children.getByRole("checkbox", { name: "Sensory Systems", exact: true }).check()
    await save.click()
    await expect(dialog.getByRole("status")).toContainText("Saved.")
    expect((await (await request.get("/api/settings")).json()).trending.anchors).toEqual([selected])
    expect(refreshes).toBe(0)

    for (const viewport of [
      { name: "desktop", width: 1440, height: 1000, theme: "light" },
      { name: "phone", width: 390, height: 844, theme: "dark" },
    ]) {
      await request.put("/api/settings", { data: { ui: { theme: viewport.theme } } })
      await page.setViewportSize(viewport)
      await page.goto("/settings?section=trending")
      await expect(summary).toContainText("Cognitive Neuroscience · Sensory Systems")
      await expect(children).toHaveCount(0)
      await summary.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath("subfields-collapsed-" + viewport.name + ".png") })
      await summary.click()
      await expect(children.getByRole("checkbox", { name: "Cognitive Neuroscience", exact: true })).toBeChecked()
      await expect(children.getByRole("checkbox", { name: "Sensory Systems", exact: true })).toBeChecked()
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await children.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath("subfields-expanded-" + viewport.name + ".png") })
    }

    await dialog.getByRole("button", { name: "Include entire field", exact: true }).click()
    await expect(children.getByRole("checkbox", { checked: true })).toHaveCount(0)
    await expect(summary).toContainText("Entire field included.")
    await save.click()
    await expect(dialog.getByRole("status")).toContainText("Saved.")
    expect((await (await request.get("/api/settings")).json()).trending.anchors).toEqual([{ ...neuro, subfieldIds: [] }])
    await children.getByRole("checkbox", { name: "Cognitive Neuroscience", exact: true }).check()
    await dialog.getByRole("button", { name: "Remove Neuroscience", exact: true }).click()
    await neuroCheckbox.check()
    await expect(summary).toContainText("Entire field included.")
    await save.click()
    await expect(dialog.getByRole("status")).toContainText("Saved.")
    expect((await (await request.get("/api/settings")).json()).trending.anchors).toEqual([neuro])

    // Reject invalid cross-parent selections at the real settings API.
    const invalid = await request.put("/api/settings", { data: { trending: {
      ...initial, anchorsOverridden: true, anchors: [{ ...neuro, subfieldIds: ["2718"] }],
    } } })
    expect(invalid.status()).toBe(400)
    expect((await (await request.get("/api/settings")).json()).trending.anchors).toEqual([neuro])

    await request.put("/api/settings", { data: { trending: { ...initial, anchorsOverridden: true, anchors: [selected] } } })
    const board: TrendingBoard = {
      version: TRENDING_BOARD_VERSION, generatedAt: new Date().toISOString(), anchors: [selected],
      overview: { totalRecent: 42, topTopicLabel: null, topTopicGrowth: null, relevantCount: 0 },
      topics: [], breakouts: [], crossDisciplineNote: null,
    }
    await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify(board))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/trending")
    await page.getByText("Fields and subfields included", { exact: true }).click()
    await expect(page.getByText("Cognitive Neuroscience", { exact: true })).toBeVisible()
    await expect(page.getByText("Sensory Systems", { exact: true })).toBeVisible()
    expect(refreshes).toBe(0)
    await request.put("/api/settings", { data: { trending: {
      ...initial, anchorsOverridden: true, anchors: [{ ...neuro, subfieldIds: [cognitive] }],
    } } })
    await page.reload()
    await expect(page.getByText("Fixture subfield refresh requested").first()).toBeVisible()
    expect(refreshes).toBe(1)
    await expect(page.getByRole("group", { name: "Filter topics by field" })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    if (beforeBoard === null) await storage.delete(DASHBOARD_CACHE_PATH)
    else await storage.write(DASHBOARD_CACHE_PATH, beforeBoard)
    await request.put("/api/settings", { data: { trending: beforeSettings.trending, ui: { theme: beforeSettings.ui.theme } } })
  }
})
