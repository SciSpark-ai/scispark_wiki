import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION } from "../src/lib/trending/cache"
import { canonicalAnchor } from "../src/lib/trending/openalex-fields"
import type { TrendingBoard } from "../src/lib/trending/types"

test("official Trending fields support explicit selection, suggestions and broad-only boards", async ({ page, request }, testInfo) => {
  const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH
  if (!vaultPath) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(vaultPath)
  const beforeSettings = await (await request.get("/api/settings")).json()
  const beforeBoard = await storage.read(DASHBOARD_CACHE_PATH)
  const beforeInterests = await storage.read("interests.md")
  const errors: string[] = []
  let refreshes = 0
  page.on("pageerror", (error) => errors.push(error.message))
  // Settings persistence is real; source/AI responses are controlled fixtures.
  await page.route("**/api/skills/trending/refresh", async (route) => {
    refreshes++
    expect(route.request().postDataJSON()).toEqual({ fields: [] })
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", message: "Fixture source outage" }) + "\n" })
  })
  await page.route("**/api/settings/trending/suggestions", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ labels: ["Auditory attention"] })
    await route.fulfill({ json: { anchors: [canonicalAnchor("28")] } })
  })
  try {
    await storage.write("interests.md", "# Interests\n")
    expect((await request.put("/api/settings", { data: { trending: {
      fields: [], cadence: "weekly", anchors: [], anchorsOverridden: false,
    } } })).ok()).toBe(true)
    await page.goto("/settings?section=trending")
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
    const save = dialog.getByRole("button", { name: "Save", exact: true })
    const search = dialog.getByRole("searchbox", { name: "Find a general field" })
    const neuro = dialog.getByRole("checkbox", { name: "Neuroscience", exact: true })
    await expect(dialog.getByRole("heading", { name: "General fields", exact: true })).toBeVisible()
    await expect(dialog.getByRole("checkbox")).toHaveCount(26)
    await search.fill("Hearing science")
    await search.press("Enter")
    await expect(dialog.getByText("No matching field.", { exact: true })).toBeVisible()
    expect((await (await request.get("/api/settings")).json()).trending.anchors).toEqual([])
    await search.fill("Neuro")
    await neuro.focus()
    await neuro.press("Space")
    await expect(neuro).toBeChecked()
    await search.fill("")
    await dialog.getByRole("checkbox", { name: "Psychology", exact: true }).check()
    await dialog.getByRole("checkbox", { name: "Medicine", exact: true }).check()
    await expect(dialog.getByRole("checkbox", { name: "Computer Science", exact: true })).toBeDisabled()
    await save.click()
    await expect(dialog.getByRole("status")).toContainText("Saved.")
    let stored = (await (await request.get("/api/settings")).json()).trending
    expect(stored.anchors).toEqual(["28", "32", "27"].map(canonicalAnchor))
    expect(stored.anchorsOverridden).toBe(true)
    await page.goto("/settings?section=trending")
    await expect(neuro).toBeChecked()
    await dialog.getByRole("button", { name: "Remove Psychology", exact: true }).click()
    await dialog.getByRole("button", { name: "Remove Medicine", exact: true }).click()
    await dialog.getByRole("button", { name: "Remove Neuroscience", exact: true }).click()
    await expect(save).toBeDisabled()
    await dialog.getByRole("button", { name: "Add interest", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Interest 1", exact: true }).fill("Auditory attention")
    await dialog.getByRole("button", { name: "Suggest from my interests", exact: true }).click()
    await expect(dialog.getByText("Suggested fields. Choose any to add.")).toBeVisible()
    await expect(neuro).not.toBeChecked()
    await expect(save).toBeDisabled()
    await dialog.getByRole("button", { name: "Add Neuroscience", exact: true }).click()
    await expect(neuro).toBeChecked()
    await dialog.getByRole("button", { name: "Remove interest 1", exact: true }).click()
    await save.click()
    await expect(dialog.getByRole("status")).toContainText("Saved.")
    stored = (await (await request.get("/api/settings")).json()).trending
    expect(stored.anchors).toEqual([canonicalAnchor("28")])
    expect(stored.fields).toEqual([])
    expect(refreshes).toBe(0)

    for (const viewport of [
      { name: "desktop", width: 1440, height: 900, theme: "light" },
      { name: "phone", width: 390, height: 844, theme: "dark" },
    ]) {
      await request.put("/api/settings", { data: { ui: { theme: viewport.theme } } })
      await page.setViewportSize(viewport)
      await page.goto("/settings?section=trending")
      await expect(neuro).toBeChecked()
      await expect(save).toBeVisible()
      for (const line of ["Choose up to 3 fields.", "From OpenAlex’s official list."]) {
        expect(await dialog.getByText(line, { exact: true }).evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size
        })).toBe(1)
      }
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath("trending-fields-" + viewport.name + ".png") })
    }

    // A general field alone is sufficient; no narrow interest is required.
    const board: TrendingBoard = {
      version: TRENDING_BOARD_VERSION, generatedAt: new Date().toISOString(), anchors: stored.anchors,
      overview: { totalRecent: 42, topTopicLabel: null, topTopicGrowth: null, relevantCount: 0 },
      topics: [], breakouts: [], crossDisciplineNote: null,
    }
    await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify(board))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/trending")
    await expect(page.getByRole("group", { name: "Filter topics by field" }).getByRole("button", { name: "Neuroscience", exact: true })).toBeVisible()
    expect(refreshes).toBe(0)
    await page.getByRole("button", { name: "Refresh", exact: true }).click()
    await expect(page.getByText("Fixture source outage")).toBeVisible()
    expect(refreshes).toBe(1)
    expect(errors).toEqual([])
  } finally {
    for (const [path, original] of [[DASHBOARD_CACHE_PATH, beforeBoard], ["interests.md", beforeInterests]] as const) {
      if (original === null) await storage.delete(path)
      else await storage.write(path, original)
    }
    await request.put("/api/settings", { data: { trending: beforeSettings.trending, ui: { theme: beforeSettings.ui.theme } } })
  }
})
