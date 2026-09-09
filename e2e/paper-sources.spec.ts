import { expect, test } from "@playwright/test"

test("personal S2 key settings persist, remain redacted, and separate saved from verified", async ({ page, request }, testInfo) => {
  const beforeTheme = (await (await request.get("/api/settings")).json()).ui.theme
  const beforeSources = (await (await request.get("/api/settings/paper-sources")).json()).enabledSources
  // Real settings API + disposable filesystem vault; replace only the external
  // connection-test response. Never send a fake credential to Semantic Scholar.
  let outcome = "rate_limited"
  let testCalls = 0
  await page.route("**/api/settings/paper-sources/test-connection", async (route) => {
    expect(route.request().postDataJSON()).toEqual({})
    testCalls++
    await route.fulfill({ json: { result: outcome === "ok"
      ? { outcome, message: "Connection verified. Semantic Scholar accepted a search using your API key." }
      : { outcome, message: "Semantic Scholar rate-limited this test. Your key is still saved; wait before trying again. This does not tell us whether the key is valid." },
    } })
  })
  try {
    await page.goto("/settings?section=sources")
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
    await expect(dialog.getByRole("heading", { name: "Paper sources" })).toBeVisible()
    const saveSources = dialog.getByRole("button", { name: "Save sources", exact: true })
    for (const name of ["arXiv", "OpenAlex", "Semantic Scholar", "PubMed"]) {
      await expect(dialog.getByRole("checkbox", { name, exact: true })).toBeChecked()
      await dialog.getByRole("checkbox", { name, exact: true }).uncheck()
    }
    await expect(saveSources).toBeDisabled()
    await expect(dialog.getByText("Choose at least one source.")).toBeVisible()
    await dialog.getByRole("checkbox", { name: "arXiv", exact: true }).check()
    await dialog.getByRole("checkbox", { name: "PubMed", exact: true }).check()
    await saveSources.click()
    await expect(dialog.getByRole("status")).toContainText("Sources saved")
    expect(testCalls).toBe(0)
    expect((await (await request.get("/api/settings/paper-sources")).json()).enabledSources).toEqual(["arxiv", "pubmed"])
    expect((await request.get("/api/search/s2?q=attention")).status()).toBe(403)
    await page.goto("/papers?new=1")
    await page.getByRole("button", { name: "Search scope", exact: true }).click()
    await expect(page.getByRole("checkbox", { name: "arXiv", exact: true })).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "PubMed", exact: true })).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "Semantic Scholar", exact: true })).toHaveCount(0)
    await expect(page.getByRole("checkbox", { name: "OpenAlex", exact: true })).toHaveCount(0)
    await page.goto("/settings?section=sources")
    await expect(dialog.getByRole("checkbox", { name: "arXiv", exact: true })).toBeChecked()
    await expect(dialog.getByRole("checkbox", { name: "PubMed", exact: true })).toBeChecked()
    await expect(dialog.getByRole("checkbox", { name: "OpenAlex", exact: true })).not.toBeChecked()
    await expect(dialog.getByText("Anonymous access", { exact: true })).toBeVisible()
    const input = dialog.getByLabel("Semantic Scholar API key", { exact: true })
    const probe = dialog.getByRole("button", { name: /^(Save & test connection|Test connection)$/ })
    await expect(probe).toBeDisabled()
    await expect(input).toHaveAttribute("type", "password")
    await input.fill("e2e-source-key-not-real")
    await dialog.getByRole("button", { name: "Save & test connection", exact: true }).click()
    await expect(dialog.getByText("API key configured", { exact: true })).toBeVisible()
    await expect(input).toHaveValue("")
    await expect(dialog.getByRole("alert")).toContainText("rate-limited")
    expect(testCalls).toBe(1)
    for (const endpoint of ["/api/settings", "/api/settings/paper-sources"]) {
      expect(await (await request.get(endpoint)).text()).not.toContain("e2e-source-key-not-real")
    }
    await page.goto("/settings?section=sources")
    await expect(dialog.getByText("API key configured", { exact: true })).toBeVisible()
    await expect(input).toHaveValue("")
    await expect(dialog.getByText(/Connection verified/)).toHaveCount(0)
    outcome = "ok"
    await probe.click()
    await expect(dialog.getByRole("status")).toContainText("Connection verified")
    expect(testCalls).toBe(2)
    // A replacement uses the same button and is saved before its automatic probe.
    await input.fill("replacement-source-key")
    await expect(probe).toHaveText("Save & test connection")
    await probe.click()
    await expect(input).toHaveValue("")
    await expect(dialog.getByRole("status")).toContainText("Connection verified")
    expect(testCalls).toBe(3)

    for (const viewport of [
      { name: "desktop", width: 1440, height: 900, theme: "light" },
      { name: "phone", width: 390, height: 844, theme: "dark" },
    ]) {
      await request.put("/api/settings", { data: { ui: { theme: viewport.theme } } })
      await page.setViewportSize(viewport)
      await page.goto("/settings?section=sources")
      await expect(dialog.getByRole("checkbox", { name: "PubMed", exact: true })).toBeChecked()
      const sourceHelp = dialog.locator("#source-selection-help > span").first()
      expect(await sourceHelp.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      })).toBe(1)
      await page.screenshot({ path: testInfo.outputPath(`paper-source-selection-${viewport.name}.png`) })
      await input.scrollIntoViewIfNeeded()
      await expect(input).toBeVisible()
      await expect(probe).toBeVisible()
      await expect(dialog.getByText("Your key is saved locally on this device.")).toBeVisible()
      const privacy = dialog.locator("summary", { hasText: "Storage & privacy" })
      const disclosure = dialog.getByText("Your key is stored in your vault without encryption.")
      await expect(disclosure).toBeHidden()
      await privacy.focus()
      await page.keyboard.press("Enter")
      await expect(disclosure).toBeVisible()
      await disclosure.scrollIntoViewIfNeeded()
      await expect(dialog.getByText("It is not included in vault exports.")).toBeVisible()
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`paper-sources-${viewport.name}-privacy.png`) })
      await privacy.click()
      await expect(disclosure).toBeHidden()
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`paper-sources-${viewport.name}.png`) })
    }
    await dialog.getByRole("button", { name: "Remove saved key", exact: true }).click()
    await expect(dialog.getByText("Anonymous access", { exact: true })).toBeVisible()
    await expect(probe).toBeDisabled()
    expect((await (await request.get("/api/settings/paper-sources")).json()).enabledSources).toEqual(["arxiv", "pubmed"])
  } finally {
    await request.put("/api/settings/paper-sources", { data: { apiKey: null, enabledSources: beforeSources } })
    await request.put("/api/settings", { data: { ui: { theme: beforeTheme } } })
  }
})
