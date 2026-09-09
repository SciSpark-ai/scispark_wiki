/** Opt-in audit of the real product. Never uses the personal vault. */
import { test, expect } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"

test("audit existing product branding across themes and viewports", async ({ page, request }, testInfo) => {
  test.skip(process.env.SCISPARK_BRAND_AUDIT !== "1", "Visual audit is opt-in")
  test.setTimeout(240_000)
  const root = process.env.SCISPARK_E2E_VAULT_PATH!
  expect(root).toContain("scispark-e2e-")
  const storage = new NodeFsVaultStorage(root)
  const originalModel = await Promise.all(Object.values(USER_MODEL_PATHS).map(async path => ({ path, content: await storage.read(path) })))
  const originalSettings = await (await request.get("/api/settings")).json()
  try {
  await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Language learning", feedPrefs: "Methods and evidence", recommendations: { diversity: "balanced", learnFromFeedback: true, resetAt: null } })
  await request.put("/api/settings", { data: { companion: { chattiness: "off" } } })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort())
  const output = process.env.SCISPARK_BRAND_AUDIT_PHASE === "before" ? "/tmp/scispark-brand-before" : "/tmp/scispark-brand-after"
  await mkdir(output, { recursive: true })
  const report = []
  for (const theme of ["light", "dark"]) {
    await request.put("/api/settings", { data: { ui: { theme } } })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 })
      for (const route of ["/", "/wiki", "/chat", "/projects", "/settings", "/trending", "/spark", "/history", "/viz"]) {
        await page.goto(route)
        await expect(page.locator("main")).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await expect.poll(() => page.locator("body").innerText(), { timeout: 20000 }).not.toMatch(/(^|\n)Loading[^\n]*(\n|$)/)
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme === "dark")).toBe(theme === "dark")
        if (process.env.SCISPARK_BRAND_AUDIT_PHASE !== "before") {
          const logo = page.locator("[data-brand-logo]:visible").first()
          await expect(logo).toHaveAccessibleName("SciSpark")
          await expect.poll(() => logo.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
        }
        await page.screenshot({ path: join(output, `${route.slice(1) || "home"}-${theme}-${width}.png`), animations: "disabled" })
        const metrics = await page.evaluate(() => ({
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          heading: document.querySelector("main h1")?.textContent,
          samples: [...document.querySelectorAll("main .text-muted-text, main .text-orange, main button")].filter(el => el.getBoundingClientRect().width > 0).slice(0, 16).map(el => ({ text: el.textContent?.slice(0, 70), color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize })),
          logos: [...document.querySelectorAll("[data-brand-logo]")].filter(el => el.getBoundingClientRect().width > 0).map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        }))
        report.push({ route, theme, width, ...metrics })
        expect(metrics.pageOverflow, `${route} ${theme} ${width}`).toBe(false)
      }
    }
  }
  await writeFile(join(output, "audit.json"), JSON.stringify(report, null, 2))
  await testInfo.attach("brand-audit", { path: join(output, "audit.json"), contentType: "application/json" })
  if (process.env.SCISPARK_BRAND_AUDIT_PHASE !== "before") {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto("/wiki")
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click()
    await expect(page.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Open sidebar", exact: true }).click()
    await expect(page.locator("[data-brand-logo]:visible").first()).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole("button", { name: "Open menu", exact: true }).click()
    await expect(page.getByRole("button", { name: "Close menu", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Close menu", exact: true }).click()
    await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeVisible()
  }
  } finally {
    for (const { path, content } of originalModel) {
      if (content === null) await storage.delete(path)
      else await storage.write(path, content)
    }
    await request.put("/api/settings", { data: { ui: originalSettings.ui, companion: originalSettings.companion } })
  }
})
