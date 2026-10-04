import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { saveSession } from "../src/lib/chat/session"
import { FEED_CACHE_PATH, type FeedResult } from "../src/lib/skills/feed-cache"
import { RECOMMENDATION_VERSION } from "../src/lib/recommendation/contract"

test("reviewed design fixes preserve navigation, modal focus and readable research context", async ({ page, request }, info) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const beforeFeed = await storage.read(FEED_CACHE_PATH)
  const profile = await request.post("/api/profile", { data: { name: "Ada", role: "Researcher", fields: "Neuroscience", topics: "Speech", feedPrefs: "Methods" } })
  expect(profile.status()).toBe(201)
  const { changesetId } = await profile.json()
  const title = "Compare speech research methods with the same starting words…"
  const rawTopics = ["attention switching) — very strong", "auditory attention decoding (eeg"]
  const feed: FeedResult = {
    generatedAt: new Date().toISOString(), costUsd: 0, strategy: { queries: [{ source: "openalex", query: "speech", rationale: "Synthetic design fixture" }] }, stats: { retrieved: 1, ranked: 1 },
    items: [{ paper: { ids: { doi: "10.1000/design-check" }, title: "Synthetic speech research paper", authors: [], fields: ["Neuroscience"], source: "openalex", year: 2026 },
      score: 70, whyThis: "", whyYou: "", whyNow: "", tags: rawTopics,
      ranking: { version: RECOMMENDATION_VERSION, relevance: 70, recency: 50, venue: null, feedbackAdjustment: 0, total: 70, assessment: null, matchedTopics: rawTopics, dateStatus: "recent", confidence: "abstract", sources: ["openalex"], queries: [] },
    }],
  }
  try {
    await page.setViewportSize({ width: 1280, height: 900 })
    await storage.write(FEED_CACHE_PATH, JSON.stringify(feed))
    for (const [index, createdAt] of ["2026-10-04T08:49:00Z", "2026-10-04T08:50:00Z"].entries()) {
      await saveSession(storage, { id: `chat_design_${index}`, title, createdAt, updatedAt: createdAt,
        messages: [{ role: "user", content: `${title} ${index ? "encoding" : "decoding"}` }, { role: "assistant", content: "Saved synthetic response." }] })
    }
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Synthetic speech research paper" })).toBeVisible()
    await expect(page.getByText("attention switching", { exact: true })).toBeVisible()
    await expect(page.getByText("auditory attention decoding", { exact: true })).toBeVisible()
    await page.getByText("Why this paper?", { exact: true }).click()
    await expect(page.getByText(/Selected for your interest in attention switching\) — very strong/)).toBeVisible()
    const chats = page.getByRole("list", { name: "Recent chats" })
    await expect(chats.locator("time")).toHaveCount(2)
    expect(new Set(await chats.locator("time").allTextContents()).size).toBe(2)
    await page.screenshot({ path: info.outputPath("feed-topics-and-history-desktop.png") })

    await page.getByRole("button", { name: "Profile menu", exact: true }).click()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
    await expect(dialog).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press("Tab")
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    expect(await page.locator("main").evaluate((element) => !!element.closest("[inert]"))).toBe(true)
    await page.screenshot({ path: info.outputPath("settings-focus-desktop.png") })
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("button", { name: "Profile menu", exact: true })).toBeFocused()

    await page.setViewportSize({ width: 390, height: 844 })
    const openMenu = page.getByRole("button", { name: "Open menu", exact: true })
    await openMenu.click()
    const menu = page.getByRole("dialog", { name: "Navigation menu", exact: true })
    await expect(menu).toBeFocused()
    await expect(menu.getByRole("button", { name: "Close menu", exact: true })).toBeVisible()
    await expect(menu.getByRole("button", { name: /sidebar|dark mode|light mode/ })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath("mobile-menu-controls.png") })
    await page.mouse.click(360, 400)
    await expect(menu).toBeHidden()
    await expect(openMenu).toBeFocused()
    await openMenu.click()
    await menu.getByRole("link", { name: "History", exact: true }).click()
    await expect(page).toHaveURL(/\/history$/)
    await expect(menu).toBeHidden()
    await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible()
    await expect(page.locator("main").getByRole("link").filter({ hasText: title })).toHaveCount(2)
    await page.screenshot({ path: info.outputPath("mobile-history-after-navigation.png") })
    await openMenu.click()
    await menu.getByRole("link", { name: "History", exact: true }).click()
    await expect(menu).toBeHidden()
    await openMenu.click()
    await menu.getByRole("button", { name: "Profile menu", exact: true }).click()
    await menu.getByRole("button", { name: "Settings", exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(dialog).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(openMenu).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await openMenu.click()
    await expect(menu).toBeFocused()
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(menu).toBeHidden()
    await expect.poll(() => page.locator("main").evaluate((element) => !!element.closest("[inert]"))).toBe(false)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(menu).toBeHidden()
  } finally {
    for (const index of [0, 1]) await storage.delete(`.scispark/chats/chat_design_${index}.json`)
    if (beforeFeed === null) await storage.delete(FEED_CACHE_PATH)
    else await storage.write(FEED_CACHE_PATH, beforeFeed)
    expect((await request.post("/api/history/changes", { data: { changesetId } })).ok()).toBe(true)
  }
})
