import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"

test("Sparky badges retain cards and reflect streaming, themes and reduced motion", async ({ page, request }) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const originals = await Promise.all(Object.values(USER_MODEL_PATHS).map(async path => ({ path, content: await storage.read(path) })))
  const themeBefore = (await (await request.get("/api/settings")).json()).ui.theme
  const sessionPath = ".scispark/chats/chat_sparky_visual.json"
  try {
    await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Language learning", feedPrefs: "Methods and evidence" })
    await storage.write(sessionPath, JSON.stringify({ id: "chat_sparky_visual", title: "Comparing research", createdAt: "2026-09-09T12:00:00Z", updatedAt: "2026-09-09T12:00:00Z", messages: [
      { role: "user", content: "What should I look for when comparing papers?" },
      { role: "assistant", content: "Start with the research question, study population, and how each study measures its outcomes." },
    ] }))
    // UI-only stream fixture: no request reaches a model or mutates a conversation.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        if (input !== "/api/skills/chat") return originalFetch(input, init)
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          const enc = new TextEncoder()
          controller.enqueue(enc.encode(JSON.stringify({ type: "progress", stage: "answering" }) + "\n"))
          setTimeout(() => controller.enqueue(enc.encode(JSON.stringify({ type: "text", text: "Check whether differences in methods could explain the findings." }) + "\n")), 2500)
        } }), { headers: { "content-type": "application/x-ndjson" } }))
      }
    })
    for (const theme of ["light", "dark"]) {
      await request.put("/api/settings", { data: { ui: { theme } } })
      for (const width of [1440, 390]) {
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.setViewportSize({ width, height: 900 })
        await page.goto("/chat/chat_sparky_visual")
        const badge = page.locator('[data-sparky-badge]')
        await expect(badge).toHaveCount(1)
        await expect(badge).toHaveAttribute("data-state", "idle")
        await expect(badge).toHaveCSS("width", "28px")
        await expect(badge).toHaveCSS("color", theme === "light" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)")
        await expect(badge.locator("svg")).toHaveCSS("animation-name", "none")
        await expect(page.getByText("Sparky", { exact: true }).last()).toBeVisible()
        await page.getByRole("textbox", { name: "Message Sparky" }).fill("What about conflicting findings?")
        await page.getByRole("textbox", { name: "Message Sparky" }).press("Enter")
        const active = page.locator('[data-sparky-badge][data-state="thinking"]')
        await expect(active).toBeVisible()
        await expect(active.locator("svg")).not.toHaveCSS("animation-name", "none")
        await page.emulateMedia({ reducedMotion: "reduce" })
        await expect(active.locator("svg")).toHaveCSS("animation-name", "none")
        const responding = page.locator('[data-sparky-badge][data-state="responding"]')
        await expect(responding).toBeVisible()
        await expect(responding.locator("svg")).toHaveCSS("animation-name", "none")
        await expect(responding).toHaveCSS("color", theme === "light" ? "rgb(166, 71, 23)" : "rgb(251, 146, 60)")
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        await page.screenshot({ path: `/tmp/sparky-chat-${theme}-${width}.png` })
      }
    }
    await page.goto("/wiki")
    await expect(page.locator('[data-companion-toggle] [data-sparky-badge]')).toHaveCSS("width", "48px")
    await expect(page.locator('[data-companion-toggle] svg')).toHaveCSS("animation-name", "none")
  } finally {
    await storage.delete(sessionPath)
    for (const { path, content } of originals) { if (content === null) await storage.delete(path); else await storage.write(path, content) }
    await request.put("/api/settings", { data: { ui: { theme: themeBefore } } })
  }
})
