import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { FEED_CACHE_PATH } from "../src/lib/skills/feed-cache"
import { seedUserModel } from "../src/lib/usermodel/pages"

test("selected text uses Sparky and recovers one pending answer across navigation and reload", async ({ page }, info) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const paper = { ids: { arxiv: "selection-fixture" }, title: "Context fixture: auditory attention", authors: [{ name: "A. Researcher" }], abstract: "SOURCE-FIXTURE: A causal state detector adjusts temporal smoothing.", fields: [], source: "arxiv", year: 2026 }
  const source = `<article><h1>${paper.title}</h1><h2>Methods</h2><p>FULLTEXT-FIXTURE: The detector uses causal attention over a historical key-value cache. BACKGROUND-FIXTURE ${"Past EEG windows adjust temporal smoothing. ".repeat(25)}</p><h2>Results</h2><p>Stable decoding.</p></article>`
  await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Attention", feedPrefs: "Methods" })
  await storage.write(FEED_CACHE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), costUsd: 0, strategy: { queries: [{ source: "arxiv", query: "attention", rationale: "fixture" }] }, stats: { retrieved: 1, ranked: 1 }, items: [{ paper, score: 1, whyThis: "", whyYou: "", whyNow: "" }] }))
  await storage.write("sources/arxiv-selection-fixture.html", source)
  const requests: Record<string, unknown>[] = []
  let legacyCalls = 0
  page.on("request", req => {
    if (req.method() !== "POST") return
    if (req.url().endsWith("/api/skills/chat")) requests.push(req.postDataJSON())
    if (req.url().endsWith("/api/skills/ask")) legacyCalls++
  })
  await page.goto("/paper/selection-fixture")
  await page.getByRole("heading", { name: paper.title, exact: true }).click({ clickCount: 3 })
  await page.getByRole("toolbar", { name: "Selection actions" }).getByRole("button", { name: "Ask Sparky", exact: true }).click()
  const panel = page.getByRole("dialog", { name: "Chat with Sparky" })
  await expect(panel.getByLabel("Selected passage", { exact: true })).toContainText(paper.title)
  await expect(panel.locator("[data-streaming-reply]")).toBeVisible()
  await expect.poll(() => requests.length).toBe(1)
  const id = String(requests[0].sessionId)
  // Confirm the server has accepted the work before leaving the route.
  await expect.poll(async () => JSON.parse(await storage.read(`.scispark/chats/${id}.json`) ?? "null")?.messages.length).toBe(1)
  await page.getByRole("link", { name: "Wiki", exact: true }).click()
  await expect(page).toHaveURL(/\/wiki$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/paper\/selection-fixture$/)
  await page.reload()
  await page.getByRole("button", { name: "Open Sparky chat", exact: true }).click()
  const answer = "For this attention paper, the detector uses causal attention over a historical key-value cache to adjust temporal smoothing."
  await expect(panel.getByText(answer, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(panel.locator("[data-streaming-reply]")).toBeHidden()
  expect(requests).toHaveLength(1)
  expect(legacyCalls).toBe(0)
  await expect(panel.getByLabel("Paper context")).toContainText("Full text")
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(panel).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`selected-sparky-${width}.png`) })
  }
  await panel.getByRole("button", { name: "Save to knowledge base", exact: true }).click()
  const savedLink = panel.getByRole("link", { name: "View page", exact: true })
  await expect(savedLink).toBeVisible()
  const savedPath = (await savedLink.getAttribute("href"))!.slice(1) + ".md"
  const saved = await storage.read(savedPath)
  expect(saved).toContain(`> ${paper.title}`)
  expect(saved).toContain(`chat:${id}`)
  expect(saved).toContain("paper:arxiv:selection-fixture")
  await panel.getByRole("link", { name: "Open full conversation" }).click()
  await expect(page).toHaveURL(new RegExp(`/chat/${id}$`))
  // The saved transcript uses the same quote and paper scope in the full chat.
  await expect(page.locator("main").getByLabel("Selected passage", { exact: true })).toContainText(paper.title)
  await page.reload()
  await page.getByRole("textbox", { name: "Message Sparky" }).fill("What does it smooth?")
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByText(answer, { exact: true })).toHaveCount(2, { timeout: 20_000 })
  expect(requests).toHaveLength(2)
  expect(requests[1].sessionId).toBe(id)
  const session = JSON.parse((await storage.read(`.scispark/chats/${id}.json`))!)
  expect(session.messages).toHaveLength(4)
  expect(session.messages[0].selection.text).toContain(paper.title)
  expect(session.paperContext.source.access).toBe("full-text")
})
