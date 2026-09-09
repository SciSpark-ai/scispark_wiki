import { test, expect } from "@playwright/test"
import sharp from "sharp"

test("wordmark has transparent negative space on both real header backgrounds", async ({ page, request }) => {
  const original = (await (await request.get("/api/settings")).json()).ui.theme
  await page.emulateMedia({ reducedMotion: "reduce" })
  try {
    for (const theme of ["light", "dark"]) {
      await request.put("/api/settings", { data: { ui: { theme } } })
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto("/onboarding")
        const logo = page.locator("[data-brand-logo]:visible").first()
        await expect(logo).toHaveAccessibleName("SciSpark")
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme === "dark")).toBe(theme === "dark")
        await expect.poll(() => logo.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
        const details = await logo.evaluate(el => {
          let parent = el.parentElement
          while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)") parent = parent.parentElement
          return { blend: getComputedStyle(el).mixBlendMode, background: getComputedStyle(parent!).backgroundColor }
        })
        expect(details.blend).toBe("normal")
        const expected = details.background.match(/[\d.]+/g)!.slice(0, 3).map(Number)
        const { data, info } = await sharp(await logo.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        // All four corners must reveal the actual enclosing surface, not a paper matte.
        for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
          for (let channel = 0; channel < 3; channel++) expect(Math.abs(data[(y * info.width + x) * 4 + channel] - expected[channel])).toBeLessThanOrEqual(1)
        }
        await page.screenshot({ path: `/tmp/scispark-transparent-logo-${theme}-${width}.png`, clip: { x: 0, y: 0, width: width === 1440 ? 240 : 390, height: 65 } })
      }
    }
  } finally {
    await request.put("/api/settings", { data: { ui: { theme: original } } })
  }
})
