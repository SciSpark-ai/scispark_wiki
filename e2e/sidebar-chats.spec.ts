import { expect, test, type Locator } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { saveSession } from "../src/lib/chat/session"

test("History owns recent chats and Sparky resumes the current conversation on desktop and mobile", async ({ page, request }, testInfo) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const id = "chat_sidebar_placement"
  const title = "Compare speech research methods"
  const response = "Saved conversation for sidebar navigation."
  let modelCalls = 0
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/skills/chat")) modelCalls++ })
  const profile = await request.post("/api/profile", { data: { name: "Ada", role: "Researcher", fields: "Neuroscience", topics: "Speech", feedPrefs: "Methods" } })
  expect(profile.status()).toBe(201)
  const { changesetId } = await profile.json()
  await saveSession(storage, {
    id, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messages: [{ role: "user", content: title }, { role: "assistant", content: response }],
  })

  async function checkPlacement(nav: Locator) {
    const chats = nav.getByRole("list", { name: "Recent chats" })
    await expect(chats.getByRole("link", { name: title })).toBeVisible()
    const history = await nav.getByRole("link", { name: "History", exact: true }).boundingBox()
    const chat = await chats.boundingBox()
    expect(history).not.toBeNull()
    expect(chat).not.toBeNull()
    expect(chat!.y).toBeGreaterThanOrEqual(history!.y + history!.height)
  }

  try {
    await page.goto("/history")
    const desktop = page.getByRole("complementary").getByRole("navigation")
    await checkPlacement(desktop)
    await page.screenshot({ path: testInfo.outputPath("sidebar-chats-desktop.png") })
    await desktop.getByRole("link", { name: title }).click()
    await expect(page).toHaveURL(new RegExp(`/chat/${id}$`))
    await expect(page.getByText(response, { exact: true })).toBeVisible()
    const composer = page.getByRole("textbox", { name: "Message Sparky" })
    await composer.fill("Keep my unfinished follow-up")
    await desktop.getByRole("link", { name: "Wiki", exact: true }).click()
    await page.reload()
    await desktop.getByRole("link", { name: "Sparky", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/chat/${id}$`))
    await expect(page.getByText(response, { exact: true })).toBeVisible()
    await expect(composer).toHaveValue("Keep my unfinished follow-up")
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click()
    await expect(desktop.getByRole("list", { name: "Recent chats" })).toHaveCount(0)
    await page.getByRole("button", { name: "Open sidebar", exact: true }).click()
    await checkPlacement(desktop)
    await page.getByRole("link", { name: "New chat", exact: true }).click()
    await expect(page.locator("[data-chat-start]")).toBeVisible()
    await desktop.getByRole("link", { name: "Wiki", exact: true }).click()
    await desktop.getByRole("link", { name: "Sparky", exact: true }).click()
    await expect(page.locator("[data-chat-start]")).toBeVisible()
    await desktop.getByRole("list", { name: "Recent chats" }).getByRole("link", { name: title }).click()
    await expect(page.getByText(response, { exact: true })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole("button", { name: "Open menu", exact: true }).click()
    const mobile = page.getByRole("complementary").getByRole("navigation")
    await expect.poll(async () => (await mobile.locator("..").boundingBox())?.x).toBe(0)
    await checkPlacement(mobile)
    await page.screenshot({ path: testInfo.outputPath("sidebar-chats-mobile.png") })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await mobile.getByRole("link", { name: title }).click()
    await mobile.getByRole("link", { name: "Wiki", exact: true }).click()
    await expect(page).toHaveURL(/\/wiki$/)
    await mobile.getByRole("link", { name: "Sparky", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/chat/${id}$`))
    await page.getByRole("button", { name: "Close menu", exact: true }).click()
    await expect(page.getByText(response, { exact: true })).toBeVisible()
    await expect(composer).toHaveValue("Keep my unfinished follow-up")
    expect(modelCalls).toBe(0)
  } finally {
    await storage.delete(`.scispark/chats/${id}.json`)
    expect((await request.post("/api/history/changes", { data: { changesetId } })).ok()).toBe(true)
  }
})
