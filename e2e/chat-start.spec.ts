import { randomUUID } from "node:crypto"
import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"

test("Sparky starts with a centered draft and research options without reopening history", async ({ page, request }) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const originals = await Promise.all(Object.values(USER_MODEL_PATHS).map(async path => ({ path, content: await storage.read(path) })))
  const toolsBefore = await storage.read(".scispark/tools/state.json")
  const library = (await (await request.get("/api/tools?view=library")).json()).result
  const tool = library.tools.find((t: { ref: { skillId: string } }) => t.ref.skillId === "find-papers")
  await request.post(`/api/tools/${encodeURIComponent(JSON.stringify([tool.ref.packageId, tool.ref.skillId]))}`, { data: { action: "enable", enabled: true, operationId: randomUUID() } })
  const themeBefore = (await (await request.get("/api/settings")).json()).ui.theme
  const path = ".scispark/chats/chat_start_fixture.json"
  let calls = 0
  let submitted: { mode?: string; question?: string; explicitTool?: unknown; sources?: string[] } = {}
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
        const options = page.getByRole("button", { name: tool.name, exact: true })
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
    await page.getByRole("button", { name: tool.name, exact: true }).click()
    const sourceOptions = page.locator("details input[type=checkbox]")
    const allowedSources = (await (await request.get("/api/settings/paper-sources")).json()).enabledSources as string[]
    for (const checkbox of await sourceOptions.all()) await checkbox.uncheck()
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
    expect(calls).toBe(0)
    await sourceOptions.first().check()
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect.poll(() => calls).toBe(1)
    expect(submitted).toMatchObject({ mode: "chat", explicitTool: tool.ref, sources: [allowedSources[0]], question: "How do researchers compare conflicting findings?" })
    await expect(page.getByRole("textbox", { name: "Message Sparky" })).toHaveValue("How do researchers compare conflicting findings?")
    await page.getByText("Recent conversations", { exact: true }).click()
    await page.getByRole("link", { name: "A saved research discussion", exact: true }).click()
    await expect(page.getByText("Saved reply for visual testing.", { exact: true })).toBeVisible()
    await expect(page.locator("[data-chat-start]")).toHaveCount(0)
  } finally {
    if (toolsBefore === null) await storage.delete(".scispark/tools/state.json"); else await storage.write(".scispark/tools/state.json", toolsBefore)
    await storage.delete(path)
    for (const { path, content } of originals) { if (content === null) await storage.delete(path); else await storage.write(path, content) }
    await request.put("/api/settings", { data: { ui: { theme: themeBefore } } })
  }
})

test("exact tool links validate without dispatch and block malformed, stale and disabled selections", async ({ page, request }) => {
  const library = (await (await request.get("/api/tools?view=library")).json()).result
  const tool = library.tools.find((t: { ref: { skillId: string } }) => t.ref.skillId === "find-papers")
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!), before = await storage.read(".scispark/tools/state.json")
  let calls=0
  await page.route("**/api/skills/chat",async route=>{calls++;await route.fulfill({status:500,json:{error:"Fixture stopped"}})})
  const management = `/api/tools/${encodeURIComponent(JSON.stringify([tool.ref.packageId,tool.ref.skillId]))}`
  try {
    await request.post(management,{data:{action:"enable",enabled:true,operationId:randomUUID()}})
    await page.goto(`/chat?tool=${encodeURIComponent(JSON.stringify(tool.ref))}`)
    await expect(page.getByRole("button",{name:tool.name,exact:true})).toHaveAttribute("aria-pressed","true")
    expect(calls).toBe(0)
    for(const value of ["", "not-json",JSON.stringify({...tool.ref,digest:"f".repeat(64)})]) {
      await page.goto(`/chat?tool=${encodeURIComponent(value)}`)
      await expect(page.getByRole("alert").filter({hasText:"tool link"})).toBeVisible()
      await page.getByRole("textbox",{name:"Message Sparky"}).fill("Run this research")
      await page.getByRole("button",{name:"Send",exact:true}).click()
      expect(calls).toBe(0)
    }
    await request.post(management,{data:{action:"enable",enabled:false,operationId:randomUUID()}})
    await page.goto(`/chat?tool=${encodeURIComponent(JSON.stringify(tool.ref))}`)
    await expect(page.getByRole("alert").filter({hasText:"tool link"})).toBeVisible()
    await page.getByRole("textbox",{name:"Message Sparky"}).fill("Run this research")
    await page.getByRole("button",{name:"Send",exact:true}).click(); expect(calls).toBe(0)
    await request.post(management,{data:{action:"enable",enabled:true,operationId:randomUUID()}})
    for (const [index, replacement] of [tool.name, "Discuss research"].entries()) {
      await page.goto(`/chat?tool=${encodeURIComponent(JSON.stringify({...tool.ref,digest:"f".repeat(64)}))}`)
      await expect(page.getByRole("alert").filter({hasText:"tool link"})).toBeVisible()
      await page.getByRole("button",{name:replacement,exact:true}).click()
      await page.evaluate(()=>window.dispatchEvent(new Event("scispark-tools-changed")))
      await expect(page.getByRole("alert").filter({hasText:"tool link"})).toHaveCount(0)
      await page.getByRole("textbox",{name:"Message Sparky"}).fill("Discuss language methods")
      await page.getByRole("button",{name:"Send",exact:true}).click()
      await expect.poll(()=>calls).toBe(index+1)
    }
  } finally { if(before===null) await storage.delete(".scispark/tools/state.json");else await storage.write(".scispark/tools/state.json",before) }
})
