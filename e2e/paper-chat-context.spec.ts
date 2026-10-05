import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { FEED_CACHE_PATH } from "../src/lib/skills/feed-cache"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"

test("Sparky knows the open unsaved paper, retains context in History and resets on paper navigation", async ({ page }, info) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const digestPath = ".scispark/digests/context-e2e-paper.json"
  const sourcePath = "sources/arxiv-context-e2e-paper.html"
  const paths = [FEED_CACHE_PATH, digestPath, sourcePath, ...Object.values(USER_MODEL_PATHS)]
  const originals = await Promise.all(paths.map(async path => ({ path, content: await storage.read(path) })))
  const paper = { ids: { arxiv: "context-e2e-paper" }, title: "Context fixture: auditory attention — state-guided adaptive decisions for robust EEG-based attention switch decoding", authors: [{ name: "A. Researcher" }], abstract: "SOURCE-FIXTURE: A causal state detector adjusts temporal smoothing.", fields: [], source: "arxiv", year: 2026, date: new Date().toISOString().slice(0, 10) }
  const other = { ...paper, ids: { arxiv: "context-other-paper" }, title: "Context fixture: a different paper" }
  const answer = "For this attention paper, the detector uses causal attention over a historical key-value cache to adjust temporal smoothing."
  const requests: Record<string, unknown>[] = []
  page.on("request", req => { if (req.method() === "POST" && req.url().endsWith("/api/skills/chat")) requests.push(req.postDataJSON()) })
  try {
    await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Language learning", feedPrefs: "Methods and evidence" })
    await storage.write(FEED_CACHE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), costUsd: 0, strategy: { queries: [{ source: "arxiv", query: "attention", rationale: "fixture" }] }, stats: { retrieved: 2, ranked: 2 }, items: [paper, other].map(paper => ({ paper, score: 1, whyThis: "Attention", whyYou: "Research", whyNow: "Recent" })) }))
    await storage.write(digestPath, JSON.stringify({ summary: "DIGEST-FIXTURE: The detector algorithm is not described.", laySummary: "Tracks attention.", keyPoints: ["Adaptive smoothing"], methods: "A causal state detector.", limitations: "Only an abstract is available.", fieldContext: "EEG decoding." }))
    await storage.write(sourcePath, `<article><h1>${paper.title}</h1><h2>Methods</h2><p>FULLTEXT-FIXTURE: The detector uses causal attention over a historical key-value cache. ${"It adjusts temporal smoothing from past EEG windows. ".repeat(20)}</p><h2>Results</h2><p>Stable attention decoding.</p></article>`)
    await page.goto("/paper/context-e2e-paper")
    await expect(page.getByRole("heading", { name: "Paper digest", exact: true })).toBeVisible()
    await expect(page.getByText("Source not recorded", { exact: false })).toHaveCount(0)
    await page.getByRole("button", { name: "Update digest from full text", exact: true }).click()
    await expect(page.getByText("Generated · Full text", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Digest generated", exact: true })).toBeDisabled()
    await expect(page.locator("#digest-methods")).toContainText("historical key-value cache")
    await page.getByRole("button", { name: "Open Sparky chat", exact: true }).click()
    const panel = page.getByRole("dialog", { name: "Chat with Sparky" })
    await expect(panel.getByLabel("Paper context")).toContainText(paper.title)
    await expect(panel.getByText("Let's unpack this paper.", { exact: true })).toBeVisible()
    expect(requests).toHaveLength(0)
    const input = panel.getByRole("textbox", { name: "Message Sparky" })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(panel).toBeInViewport({ ratio: 1 })
      await expect(input).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`paper-chat-empty-${width}.png`) })
    }
    await input.fill("How does the causal state detector work?")
    await panel.getByRole("button", { name: "Send", exact: true }).click()
    await expect(panel.getByText(answer, { exact: true })).toBeVisible()
    await expect(panel.getByLabel("Paper context")).toContainText("Full text")
    expect(requests[0].paperSlug).toBe("context-e2e-paper")
    const chatHref = await panel.getByRole("link", { name: "Open full conversation" }).getAttribute("href")
    await panel.getByRole("button", { name: "Save to knowledge base", exact: true }).click()
    await expect(panel.getByRole("link", { name: "View page", exact: true })).toBeVisible()
    const savedPaths = await storage.list("wiki/queries/")
    const savedText = (await Promise.all(savedPaths.map(path => storage.read(path)))).join("\n")
    expect(savedText).toContain("paper:arxiv:context-e2e-paper")
    expect(savedText).toContain(paper.title)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(panel).toBeInViewport({ ratio: 1 })
      await expect(input).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`paper-chat-${width}.png`) })
    }
    // A real client-side navigation changes paper scope instead of carrying the
    // old answer or an in-flight conversation onto a different paper.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole("link", { name: "Home", exact: true }).click()
    await expect(panel.getByLabel("Paper context")).toHaveCount(0)
    await expect(panel.getByText(answer, { exact: true })).toHaveCount(0)
    await page.getByRole("heading", { name: other.title, exact: true }).click()
    await expect(panel.getByLabel("Paper context")).toContainText(other.title)
    await expect(panel.getByText(answer, { exact: true })).toHaveCount(0)
    // Resume through History, not just a panel's in-memory state.
    await page.getByRole("link", { name: "History", exact: true }).click()
    await page.locator(`a[href="${chatHref}"]`).first().click()
    await expect(page.locator(`header a[href="/paper/context-e2e-paper"]`)).toHaveText(paper.title)
    await page.reload()
    await page.getByRole("textbox", { name: "Message Sparky" }).fill("What does it smooth?")
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByText(answer, { exact: true })).toHaveCount(2)
    expect(requests).toHaveLength(2)
    expect(requests[1].sessionId).toBe(requests[0].sessionId)
    const session = JSON.parse((await storage.read(`.scispark/chats/${requests[0].sessionId}.json`))!)
    expect(session.paperContext.source.access).toBe("full-text")
    expect(session.paperContext.source.text).toContain("historical key-value cache")
    expect(session.paperContext.paper.title).toBe(paper.title)
    expect(session.messages.at(-1).blocks[0].papers[0].title).toBe(paper.title)
  } finally {
    for (const { path, content } of originals) { if (content === null) await storage.delete(path); else await storage.write(path, content) }
  }
})
