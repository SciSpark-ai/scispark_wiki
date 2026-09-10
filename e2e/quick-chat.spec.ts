import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"

test("floating Sparky opens, streams, preserves a closed chat and opens its saved transcript", async ({ page, request }) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const originals = await Promise.all(Object.values(USER_MODEL_PATHS).map(async path => ({ path, content: await storage.read(path) })))
  const themeBefore = (await (await request.get("/api/settings")).json()).ui.theme
  try {
    await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Language learning", feedPrefs: "Methods and evidence" })
    await page.goto("/")
    const launcher = page.locator("[data-companion-toggle]")
    const panel = page.getByRole("dialog", { name: "Chat with Sparky" })
    await expect(panel).toBeHidden()
    await launcher.click()
    const input = panel.getByRole("textbox", { name: "Message Sparky" })
    await expect(input).toBeFocused()
    await input.fill("What does the paper demonstrate?")
    await input.press("Escape")
    await expect(panel).toBeHidden()
    await expect(launcher).toBeFocused()
    await launcher.click()
    await expect(input).toHaveValue("What does the paper demonstrate?")
    await panel.getByRole("button", { name: "Send", exact: true }).click()
    await expect(panel.locator("[data-streaming-reply]")).toContainText("The disposable paper")
    await launcher.click()
    await expect(panel).toBeHidden()
    await launcher.click()
    await expect(panel.getByText("The disposable paper supports this project-scoped answer.", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    const href = await panel.getByRole("link", { name: "Open full conversation" }).getAttribute("href")
    expect(href).toMatch(/^\/chat\/chat_/)
    for (const theme of ["light", "dark"]) {
      const dark = await page.evaluate(() => document.documentElement.dataset.theme === "dark")
      if (dark !== (theme === "dark")) await page.getByRole("button", { name: theme === "dark" ? "Switch to dark mode" : "Switch to light mode", exact: true }).first().click()
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme === "dark")).toBe(theme === "dark")
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await expect(panel).toBeInViewport({ ratio: 1 })
        await expect(input).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: `/tmp/sparky-quick-${theme}-${width}.png` })
      }
    }
    await panel.getByRole("link", { name: "Open full conversation" }).click()
    await expect(page.getByText("The disposable paper supports this project-scoped answer.", { exact: true })).toBeVisible()
  } finally {
    for (const { path, content } of originals) { if (content === null) await storage.delete(path); else await storage.write(path, content) }
    await request.put("/api/settings", { data: { ui: { theme: themeBefore } } })
  }
})
