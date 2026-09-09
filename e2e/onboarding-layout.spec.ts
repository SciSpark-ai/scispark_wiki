import { expect, test, type Page } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { ONBOARDING_PATH } from "../src/lib/onboarding/contract"

async function expectContainedChat(page: Page) {
  const card = page.getByRole("region", { name: "Chat with Sparky" })
  await expect(card.getByRole("textbox", { name: "Your reply to Sparky" })).toBeInViewport({ ratio: 1 })
  await expect(card.getByRole("button", { name: "Send answer" })).toBeInViewport({ ratio: 1 })
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector("main")!
    const doc = document.documentElement
    return Math.max(main.scrollHeight - main.clientHeight, doc.scrollHeight - doc.clientHeight)
  })).toBeLessThanOrEqual(1)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await expect.poll(() => page.locator("main").evaluate((main) => main.scrollTop)).toBe(0)
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
  test("onboarding keeps long conversations inside the " + viewport.name + " viewport", async ({ page, request }, testInfo) => {
    const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH
    if (!vaultPath) throw new Error("Disposable vault required")
    const storage = new NodeFsVaultStorage(vaultPath)
    const before = await storage.read(ONBOARDING_PATH)
    const theme = (await (await request.get("/api/settings")).json()).ui.theme
    try {
      await storage.delete(ONBOARDING_PATH)
      expect((await request.put("/api/settings", { data: { ui: { theme: "light" } } })).ok()).toBe(true)
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.goto("/onboarding")
      await expect(page.getByPlaceholder("Your name")).toBeVisible()
      const card = await expectContainedChat(page)
      const initial = (await card.boundingBox())!
      const composer = card.getByRole("textbox", { name: "Your reply to Sparky" })
      const history = card.locator('[aria-label="Onboarding conversation"]')
      const answers = [
        "Ada",
        "Postdoc in auditory neuroscience. I work on language development, hearing, and neuroimaging methods. ".repeat(3),
        "How can we measure auditory attention? I follow longitudinal evidence, accessible datasets, and individual differences. ".repeat(3),
        "Mostly auditory neuroscience, but bring in computational methods and reproducible research from nearby fields. ".repeat(3),
        "Yes, remember my feedback",
      ]
      for (const [index, answer] of answers.entries()) {
        await composer.fill(answer)
        // Let the final answer persist, then lose its response. The normal GET
        // recovery must populate the form without replaying the paid turn.
        if (index === 4) await page.route("**/api/onboarding", async (route) => {
          await route.fetch()
          await route.abort("failed")
        }, { times: 1 })
        const turn = index === 4 ? null : page.waitForResponse((response) => response.url().endsWith("/api/onboarding") && response.request().method() === "POST")
        await composer.press("Enter")
        if (index === 0) {
          // The local provider holds its completion open. Visible partial text
          // while the composer is disabled proves real server-to-browser streaming.
          await expect(card.getByRole("log")).toContainText("What research")
          await expect(composer).toBeDisabled()
        }
        if (turn) await (await turn).finished()
        else await expect(page.getByRole("form", { name: "Review your research profile" })).toBeVisible()
        await expect(composer).toBeEnabled()
        await expectContainedChat(page)
        const current = (await card.boundingBox())!
        expect(Math.abs(current.height - initial.height)).toBeLessThanOrEqual(1)
        expect(Math.abs(current.y - initial.y)).toBeLessThanOrEqual(1)
      }
      const review = page.getByRole("form", { name: "Review your research profile" })
      await expect(review).toBeVisible()
      await expect(review.getByRole("textbox", { name: "Your name", exact: true })).toHaveValue("Ada")
      await expect(review.getByRole("checkbox", { name: "Remember my feedback for future recommendations" })).toBeChecked()
      await expect(page.getByRole("dialog")).toHaveCount(0)
      expect((await request.get("/api/profile")).status()).toBe(404)
      await expect.poll(() => history.evaluate((log) => log.scrollHeight - log.clientHeight)).toBeGreaterThan(100)
      await expect.poll(() => history.evaluate((log) => Math.abs(log.scrollHeight - log.scrollTop - log.clientHeight))).toBeLessThanOrEqual(1)
      await history.evaluate((log) => { log.scrollTop = 0 })
      await composer.fill("Keep my place while I type.")
      await expect.poll(() => history.evaluate((log) => log.scrollTop)).toBe(0)
      await expectContainedChat(page)
      await page.screenshot({ path: testInfo.outputPath("long-conversation.png") })

      await page.getByRole("button", { name: "Switch to dark mode" }).click()
      await expectContainedChat(page)
      await page.screenshot({ path: testInfo.outputPath("long-conversation-dark.png") })

      // A failed turn leaves the original draft and typed answer recoverable;
      // it must not force page scrolling or trap the composer.
      await page.route("**/api/onboarding", async (route) => {
        if (route.request().method() !== "POST") return route.continue()
        await route.fulfill({ status: 500, json: { error: "Could not reach Sparky. Please retry." } })
      })
      await composer.press("Enter")
      await expect(page.getByRole("alert").filter({ hasText: "Could not reach Sparky" })).toBeInViewport({ ratio: 1 })
      await expect(composer).toHaveValue("Keep my place while I type.")
      await expectContainedChat(page)
      await page.reload()
      await expect(review).toBeVisible()
      await expect(review.getByRole("combobox", { name: "Topic variety" })).toHaveValue("exploratory")
      await expectContainedChat(page)
    } finally {
      if (before === null) await storage.delete(ONBOARDING_PATH)
      else await storage.write(ONBOARDING_PATH, before)
      await request.put("/api/settings", { data: { ui: { theme } } })
    }
  })
}
