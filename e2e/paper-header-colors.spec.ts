import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"
import { FEED_CACHE_PATH } from "../src/lib/skills/feed-cache"

test("paper category headers use distinct warm shades in both themes", async ({ page, request }) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const originals = await Promise.all([...Object.values(USER_MODEL_PATHS), FEED_CACHE_PATH].map(async path => ({ path, content: await storage.read(path) })))
  const originalTheme = (await (await request.get("/api/settings")).json()).ui.theme
  try {
    await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Language learning", feedPrefs: "Methods and evidence" })
    await storage.write(FEED_CACHE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), costUsd: 0, strategy: { queries: [{ source: "pubmed", query: "language", rationale: "Visual fixture" }] }, stats: { retrieved: 4, ranked: 4 }, items: [
      ["Research findings", "Language learning across contexts"], ["Methods", "A new method for measuring auditory attention"], ["Review / synthesis", "A systematic review of language development"], ["Data & tools", "An open dataset for speech research"],
    ].map(([, title], i) => ({ paper: { ids: { doi: `10.1234/color-fixture-${i}` }, title, authors: [], fields: ["Language research"], source: "pubmed", date: new Date().toISOString().slice(0,10), year: 2026, abstract: "An illustrative paper for checking the research card design." }, score: 1, whyThis: "", whyYou: "", whyNow: "" })) }))
    for (const theme of ["light", "dark"]) {
      await request.put("/api/settings", { data: { ui: { theme } } })
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto("/")
        const headers = page.locator("[data-paper-category]")
        await expect(headers).toHaveCount(4)
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme === "dark")).toBe(theme === "dark")
        const colors = await headers.evaluateAll(nodes => nodes.map(n => getComputedStyle(n).backgroundColor))
        expect(new Set(colors).size).toBe(4)
        expect(colors.every(c => c !== "rgba(0, 0, 0, 0)")).toBe(true)
        await expect(headers.first()).toHaveCSS("background-color", theme === "light" ? "rgb(252, 226, 206)" : "rgb(69, 41, 24)")
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        await page.screenshot({ path: `/tmp/paper-headers-${theme}-${width}.png`, fullPage: true })
      }
    }
  } finally {
    for (const { path, content } of originals) { if (content === null) await storage.delete(path); else await storage.write(path, content) }
    await request.put("/api/settings", { data: { ui: { theme: originalTheme } } })
  }
})
