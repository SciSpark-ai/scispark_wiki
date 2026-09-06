import { expect, test } from "@playwright/test"

test("loads all branded fonts from the local app with external requests blocked", async ({ page, request, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin
  const fontRequests: string[] = []
  const externalFontRequests: string[] = []
  const beforeTheme = (await (await request.get("/api/settings")).json()).ui.theme
  page.on("request", (req) => {
    if (req.resourceType() === "font") fontRequests.push(req.url())
    if (/fonts\.(googleapis|gstatic)\.com/.test(req.url())) externalFontRequests.push(req.url())
  })
  // Keep loopback available; nothing outside the app can supply a fallback font.
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.emulateMedia({ reducedMotion: "reduce" })
  try {
    for (const viewport of [
      { name: "desktop", width: 1440, height: 900, theme: "light" },
      { name: "phone", width: 390, height: 844, theme: "dark" },
    ]) {
      expect((await request.put("/api/settings", { data: { ui: { theme: viewport.theme } } })).ok()).toBe(true)
      await page.setViewportSize(viewport)
      await page.goto("/onboarding")
      await expect(page.getByPlaceholder("Your name")).toBeVisible()
      const loaded = await page.evaluate(async () => {
        const style = getComputedStyle(document.body)
        const results = []
        for (const [variable, weight] of [["--font-geist-sans", "400"], ["--font-geist-mono", "400"], ["--font-halant", "400"], ["--font-halant", "700"]]) {
          const family = style.getPropertyValue(variable).trim()
          const primary = family.split(",")[0].replace(/["']/g, "").trim()
          const faces = await document.fonts.load(`${weight} 16px ${family}`, "SciSpark")
          results.push({ variable, weight, loaded: faces.some((face) => face.family.replace(/["']/g, "") === primary && face.status === "loaded") })
        }
        await document.fonts.ready
        return results
      })
      expect(loaded).toHaveLength(4)
      expect(loaded.every((font) => font.loaded)).toBe(true)
      expect(externalFontRequests).toEqual([])
      expect(new Set(fontRequests).size).toBe(4)
      expect(fontRequests.every((url) => new URL(url).origin === origin)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`local-fonts-${viewport.name}.png`) })
    }
  } finally {
    await request.put("/api/settings", { data: { ui: { theme: beforeTheme } } })
  }
})
