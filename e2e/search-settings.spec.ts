import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { saveSession, type ChatSession } from "../src/lib/chat/session"
import type { ResearchSearchResult } from "../src/lib/skills/research-search-contract"

const result: ResearchSearchResult = {
  query: "auditory attention",
  plan: { interpretation: "Auditory attention methods", sort: "relevance", fromDate: null,
    queries: [{ source: "pubmed", query: "auditory attention", rationale: "Methods literature" }] },
  items: [{ paper: { ids: { doi: "10.1234/search-settings-fixture" },
    title: "Auditory attention search fixture", authors: [], fields: [], source: "pubmed",
    abstract: "A disposable search result." }, score: 90,
    whyMatch: "Addresses auditory attention methods.", foundBy: [{ source: "pubmed", rationale: "Methods literature" }] }],
  stats: { retrieved: 1, deduplicated: 1 }, costUsd: 0, warnings: [],
}
test("Search snapshots, drafts and source settings survive Home, reload and History", async ({ page, request }, testInfo) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const beforeSources = (await (await request.get("/api/settings/paper-sources")).json()).enabledSources
  const session: ChatSession = {
    id: "chat_search_settings", title: "Auditory attention history fixture",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messages: [{ role: "user", content: "auditory attention" },
      { role: "assistant", content: "Found one paper.", blocks: [{ type: "paper-results", retrievedAt: new Date().toISOString(), result }] }],
  }
  // UI/persistence acceptance uses a saved fixture. The API/unit gates exercise
  // actual search orchestration. No external scholarly or AI calls here.
  await saveSession(storage, session)
  let aiRequests = 0
  page.on("request", (r) => { if (/\/api\/skills\/(chat|research-search)$/.test(r.url())) aiRequests++ })
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      expect((await request.put("/api/settings/paper-sources", { data: { enabledSources: ["pubmed", "openalex"] } })).ok()).toBe(true)
      await page.setViewportSize(viewport)
      await page.goto("/chat/chat_search_settings")
      const composer = page.getByLabel("Message Sparky")
      const paper = page.getByText("Auditory attention search fixture", { exact: true })
      await expect(paper).toBeVisible()
      await page.getByLabel("Chat mode").selectOption("search")
      await composer.fill("auditory attention in adults")
      await page.getByRole("button", { name: "Search scope", exact: true }).click()
      await page.getByRole("checkbox", { name: "OpenAlex", exact: true }).uncheck()
      const manage = page.getByRole("button", { name: "Manage sources", exact: true })
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
      for (const escape of [false, true]) {
        await manage.click()
        await expect(dialog.getByRole("heading", { name: "Paper sources", exact: true })).toBeVisible()
        await expect(page).toHaveURL(/\/chat\/chat_search_settings$/)
        await expect(composer).toHaveValue("auditory attention in adults")
        if (escape) await page.keyboard.press("Escape")
        else await dialog.getByRole("button", { name: "Close settings", exact: true }).click()
        await expect(dialog).toBeHidden()
        await expect(paper).toBeVisible()
        await expect(page.getByRole("checkbox", { name: "OpenAlex", exact: true })).not.toBeChecked()
      }
      await manage.click()
      await dialog.getByRole("checkbox", { name: "OpenAlex", exact: true }).uncheck()
      await dialog.getByRole("button", { name: "Save sources", exact: true }).click()
      await expect(dialog.getByRole("status")).toContainText("Sources saved")
      await dialog.getByRole("button", { name: "Close settings", exact: true }).click()
      await expect(page.getByRole("checkbox", { name: "OpenAlex", exact: true })).toHaveCount(0)
      await expect(page.getByRole("checkbox", { name: "PubMed", exact: true })).toBeChecked()
      await page.screenshot({ path: testInfo.outputPath(`search-history-${viewport.width}.png`) })
      const bounds = await composer.boundingBox()
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      await page.goto("/")
      await page.goto("/papers")
      await expect(page).toHaveURL(/\/chat\/chat_search_settings$/)
      await expect(paper).toBeVisible()
      await expect(composer).toHaveValue("auditory attention in adults")
      await expect(page.getByLabel("Chat mode")).toHaveValue("search")
      await page.reload()
      await expect(paper).toBeVisible()
      await expect(composer).toHaveValue("auditory attention in adults")
      await expect(page.getByLabel("Chat mode")).toHaveValue("search")
      await page.getByRole("button", { name: "Search scope", exact: true }).click()
      await expect(page.getByRole("checkbox", { name: "PubMed", exact: true })).toBeChecked()
      await page.goto("/history?tab=conversations")
      await page.getByRole("link", { name: /Auditory attention history fixture/ }).last().click()
      await expect(paper).toBeVisible()
      await page.getByLabel("Chat mode").selectOption("chat")
      await page.getByRole("switch", { name: /Read Sources Only/ }).check()
      await page.goto("/")
      await page.goto("/chat")
      await expect(page).toHaveURL(/\/chat\/chat_search_settings$/)
      await expect(page.getByRole("switch", { name: /Read Sources Only/ })).toBeChecked()
      expect(aiRequests).toBe(0)
    }
  } finally {
    expect((await request.put("/api/settings/paper-sources", { data: { enabledSources: beforeSources } })).ok()).toBe(true)
  }
})

test("a long saved conversation keeps the composer visible in both themes and at phone width", async ({ page }, testInfo) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const stamp = new Date().toISOString()
  await saveSession(storage, {
    id: "chat_layout_fixture", title: "Comparing methods for auditory attention",
    createdAt: stamp, updatedAt: stamp,
    messages: Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `Offline conversation turn ${index + 1}. This is a layout fixture, not scientific evidence. `.repeat(4),
    })),
  })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto("/chat/chat_layout_fixture")
    await expect(page.getByLabel("Message Sparky")).toBeVisible()
    await expect(page.getByText(/^Offline conversation turn 24\./)).toBeVisible()
    for (const theme of ["light", "dark"]) {
      const toggle = page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true })
      if (await toggle.isVisible()) await toggle.click()
      if (theme === "dark") await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
      else await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark")
      const layout = await page.evaluate(() => {
        const input = document.querySelector('textarea[aria-label="Message Sparky"]')!
        const conversation = document.querySelector('[aria-label="Conversation"]')!
        const rect = input.getBoundingClientRect()
        const main = document.querySelector("main")!
        return { inputBottom: rect.bottom, inputTop: rect.top, width: innerWidth,
          docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight,
          scrollsInside: conversation.scrollHeight > conversation.clientHeight,
          distanceFromLatest: conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop,
          mainOverflow: main.scrollHeight - main.clientHeight, height: innerHeight }
      })
      expect(layout.inputBottom).toBeLessThanOrEqual(viewport.height)
      expect(layout.inputTop).toBeGreaterThan(50)
      expect(layout.docWidth).toBeLessThanOrEqual(layout.width)
      expect(layout.docHeight).toBeLessThanOrEqual(layout.height)
      expect(layout.mainOverflow).toBeLessThanOrEqual(1)
      expect(layout.scrollsInside).toBe(true)
      expect(layout.distanceFromLatest).toBeLessThanOrEqual(1)
      await page.screenshot({ path: testInfo.outputPath(`conversation-${viewport.width}-${theme}.png`) })
    }
  }
})
