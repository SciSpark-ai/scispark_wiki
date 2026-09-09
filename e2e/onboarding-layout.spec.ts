import { expect, test, type Page } from "@playwright/test"

async function expectContainedChat(page: Page) {
  const card = page.getByRole("region", { name: "Chat with Sparky" })
  const composer = card.getByRole("textbox")
  await expect(composer).toBeInViewport({ ratio: 1 })
  await expect(card.getByRole("button", { name: /Send answer|Create my research space/ })).toBeInViewport({ ratio: 1 })
  const back = card.getByRole("button", { name: "Back", exact: true })
  if (await back.count()) await expect(back).toBeInViewport({ ratio: 1 })
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector("main")!
    const doc = document.documentElement
    return Math.max(main.scrollHeight - main.clientHeight, doc.scrollHeight - doc.clientHeight)
  })).toBeLessThanOrEqual(1)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await expect.poll(() => page.locator("main").evaluate((main) => main.scrollTop)).toBe(0)
  // A floating mascot must not steal the input/send area on narrow screens.
  await expect(page.locator("[data-companion-mascot]")).toHaveCount(0)
  return card
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "short desktop", width: 1280, height: 600 },
  { name: "phone", width: 390, height: 844 },
  { name: "short phone", width: 375, height: 667 },
  { name: "landscape phone", width: 844, height: 390 },
]

for (const viewport of viewports) {
  test(`onboarding keeps long conversations inside the ${viewport.name} viewport`, async ({ page }, testInfo) => {
    // Theme lives in the vault, so a new browser context alone does not reset it.
    const themeReset = await page.request.put("/api/settings", { data: { ui: { theme: "light" } } })
    expect(themeReset.ok()).toBe(true)
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/onboarding")
    await expect(page.getByPlaceholder("Your name")).toBeVisible()
    const card = await expectContainedChat(page)
    const initial = (await card.boundingBox())!
    const history = card.getByRole("log")
    const answers = [
      "Ada",
      "Postdoc in auditory neuroscience. I work on language development, hearing, and neuroimaging methods. ".repeat(3),
      "Auditory neuroscience, psychiatry, autism, speech and audio processing. I also follow computational methods and reproducible research. ".repeat(3),
      "How can we measure auditory attention? I am interested in longitudinal evidence, accessible datasets, and individual differences. ".repeat(3),
    ]
    for (const answer of answers) {
      await card.getByRole("textbox").fill(answer)
      await card.getByRole("textbox").press("Enter")
      await expectContainedChat(page)
      const current = (await card.boundingBox())!
      expect(Math.abs(current.height - initial.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(current.y - initial.y)).toBeLessThanOrEqual(1)
      const promptId = await card.getByRole("textbox").getAttribute("aria-labelledby")
      const prompt = (await page.locator(`#${promptId}`).boundingBox())!
      const log = (await history.boundingBox())!
      expect(prompt.y).toBeGreaterThanOrEqual(log.y)
      expect(prompt.y + prompt.height).toBeLessThanOrEqual(log.y + log.height)
    }
    await expect(card.getByRole("textbox")).toHaveAttribute("placeholder", /prioritize methods/)
    await card.getByRole("button", { name: /Feed preferences/ }).click()
    const preferences = page.getByRole("dialog", { name: "Your paper recommendations" })
    await preferences.getByRole("radio", { name: /Exploratory/ }).check()
    await preferences.getByRole("button", { name: "Done", exact: true }).click()
    await expect(card.getByRole("button", { name: /Feed preferences · exploratory/ })).toBeVisible()
    await expectContainedChat(page)
    await expect.poll(() => history.evaluate((log) => log.scrollHeight - log.clientHeight)).toBeGreaterThan(100)
    await expect.poll(() => history.evaluate((log) => Math.abs(log.scrollHeight - log.scrollTop - log.clientHeight))).toBeLessThanOrEqual(1)
    // Scrolling back to read history or typing must not snap it down or move the page.
    await history.evaluate((log) => { log.scrollTop = 0 })
    await card.getByRole("textbox").fill("Keep my place while I type.")
    await expect.poll(() => history.evaluate((log) => log.scrollTop)).toBe(0)
    await expectContainedChat(page)
    await card.getByRole("button", { name: "Back", exact: true }).click()
    await expect.poll(() => history.evaluate((log) => Math.abs(log.scrollHeight - log.scrollTop - log.clientHeight))).toBeLessThanOrEqual(1)
    await expectContainedChat(page)
    await page.screenshot({ path: testInfo.outputPath("long-conversation.png") })

    await page.getByRole("button", { name: "Switch to dark mode" }).click()
    await expectContainedChat(page)
    await page.screenshot({ path: testInfo.outputPath("long-conversation-dark.png") })

    // Failed persistence still leaves the composer and an honest error visible.
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      await route.fulfill({ status: 500, json: { error: "Could not save your profile. Please try again." } })
    })
    await card.getByRole("textbox").press("Enter")
    await card.getByRole("button", { name: "Create my research space" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Could not save" })).toBeInViewport({ ratio: 1 })
    await expectContainedChat(page)
  })
}
