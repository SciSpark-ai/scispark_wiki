import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"

test("Sparky starts with a centered draft and research options without reopening history", async ({ page, request }) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const originals = await Promise.all(Object.values(USER_MODEL_PATHS).map(async path => ({ path, content: await storage.read(path) })))
  const themeBefore = (await (await request.get("/api/settings")).json()).ui.theme
  const path = ".scispark/chats/chat_start_fixture.json"
  let calls = 0
  let submitted: { mode?: string; question?: string } = {}
  try {
    await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Language learning", feedPrefs: "Methods and evidence" })
    await storage.write(path, JSON.stringify({ id: "chat_start_fixture", title: "A saved research discussion", createdAt: "2026-09-09T12:00:00Z", updatedAt: "2026-09-09T12:00:00Z", messages: [{ role: "assistant", content: "Saved reply for visual testing." }] }))
    await page.route("**/api/skills/chat", async route => {
      calls++; submitted = route.request().postDataJSON()
      await route.fulfill({ status: 500, json: { error: "Fixture request stopped" } })
    })
    for (const theme of ["light", "dark"]) {
      await request.put("/api/settings", { data: { ui: { theme } } })
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto("/chat")
        await expect(page.locator("[data-chat-start]")).toBeVisible()
        await expect(page).toHaveURL(/\/chat$/)
        const field = page.getByRole("textbox", { name: "Message Sparky" })
        await expect(field).toBeInViewport()
        await page.evaluate(() => document.fonts.ready)
        const heading = page.getByRole("heading", { name: "What would you like to explore?" })
        if (width === 390) expect(await heading.evaluate(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1)).toBe(true)
        const box = (await field.boundingBox())!
        if (width === 1440) { expect(box.y).toBeGreaterThan(200); expect(box.y).toBeLessThan(550) }
        const options = page.getByRole("button", { name: "Find papers", exact: true })
        expect((await options.boundingBox())!.y).toBeGreaterThan(box.y + box.height)
        await field.fill("How do researchers compare conflicting findings?")
        await options.click()
        await expect(options).toHaveAttribute("aria-pressed", "true")
        await expect(field).toHaveValue("How do researchers compare conflicting findings?")
        await page.reload()
        await expect(field).toHaveValue("How do researchers compare conflicting findings?")
        await expect(options).toHaveAttribute("aria-pressed", "true")
        await page.getByRole("button", { name: "Discuss research", exact: true }).click()
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme === "dark")).toBe(theme === "dark")
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        await page.getByText("Conversation options", { exact: true }).click()
        const toggle = page.getByRole("switch", { name: "Saved papers only", exact: true })
        await toggle.check()
        await expect(toggle).toBeChecked()
        await toggle.focus()
        await page.keyboard.press("Space")
        await expect(toggle).not.toBeChecked()
        await field.fill("")
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: `/tmp/sparky-start-${theme}-${width}.png` })
        await field.fill("How do researchers compare conflicting findings?")
      }
    }
    expect(calls).toBe(0)
    await page.getByRole("button", { name: "Find papers", exact: true }).click()
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect.poll(() => calls).toBe(1)
    expect(submitted).toMatchObject({ mode: "search", question: "How do researchers compare conflicting findings?" })
    await expect(page.getByRole("textbox", { name: "Message Sparky" })).toHaveValue("How do researchers compare conflicting findings?")
    await page.getByText("Recent conversations", { exact: true }).click()
    await page.getByRole("link", { name: "A saved research discussion", exact: true }).click()
    await expect(page.getByText("Saved reply for visual testing.", { exact: true })).toBeVisible()
    await expect(page.locator("[data-chat-start]")).toHaveCount(0)
  } finally {
    await storage.delete(path)
    for (const { path, content } of originals) { if (content === null) await storage.delete(path); else await storage.write(path, content) }
    await request.put("/api/settings", { data: { ui: { theme: themeBefore } } })
  }
})
