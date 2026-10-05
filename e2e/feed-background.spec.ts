import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { FEED_CACHE_PATH, type FeedResult } from "../src/lib/skills/feed-cache"

const feed = (title: string): FeedResult => ({
  generatedAt: new Date().toISOString(),
  items: [{ paper: { ids: {}, title, authors: [], abstract: "Disposable navigation test paper.", fields: [], source: "arxiv" }, score: 90, whyThis: "", whyYou: "", whyNow: "" }],
  strategy: { queries: [{ source: "arxiv", query: "attention", rationale: "fixture" }] },
  costUsd: 0, stats: { retrieved: 1, ranked: 1 },
})

test("feed refresh reconnects after navigation and reload without starting a second run", async ({ page, request }, testInfo) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const beforeFeed = await storage.read(FEED_CACHE_PATH)
  const profile = await request.post("/api/profile", { data: { name: "Ada", role: "Researcher", fields: "Neuroscience", topics: "Attention", feedPrefs: "Methods" } })
  expect(profile.status()).toBe(201)
  const { changesetId } = await profile.json()
  const idle = await request.get("/api/skills/feed/refresh")
  expect(idle.ok()).toBe(true)
  expect(await idle.text()).toContain('"payload":null')
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  let started = false
  let posts = 0
  let attachments = 0
  const result = feed("Background refresh result")
  const startedAt = Date.now() - 30_000
  // Model/search work is deterministic at the transport boundary here. The route
  // regressions separately exercise the real single-flight pipeline and disconnect.
  await page.route("**/api/skills/feed/refresh", async (route) => {
    if (route.request().method() === "POST") { posts++; started = true }
    else if (!started) {
      await route.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "result", payload: null })}\n` })
      return
    } else attachments++
    await pending
    // A departed page may already have aborted its observation.
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "progress", stage: "rank", startedAt }, { type: "result", payload: result },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n" }).catch(() => {})
  })

  try {
    await storage.write(FEED_CACHE_PATH, JSON.stringify(feed("Previous feed result")))
    await page.goto("/")
    await expect(page.getByText("Previous feed result", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Refresh feed", exact: true }).click()
    await expect.poll(() => posts).toBe(1)
    await expect(page.getByRole("button", { name: "Refreshing…", exact: true })).toBeDisabled()
    await page.getByRole("link", { name: "Wiki", exact: true }).click()
    await expect(page).toHaveURL(/\/wiki$/)
    await page.getByRole("link", { name: "Home", exact: true }).click()
    await expect.poll(() => attachments).toBe(1)
    await expect(page.getByRole("button", { name: "Checking refresh…", exact: true })).toBeDisabled()
    await page.reload()
    await expect.poll(() => attachments).toBe(2)
    expect(posts).toBe(1)

    await storage.write(FEED_CACHE_PATH, JSON.stringify(result))
    release()
    await expect(page.getByText("Background refresh result", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Refresh feed", exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath("feed-finished-after-navigation.png"), fullPage: true })

    // Once finished, returning loads the saved cache and the read-only check is idle.
    started = false
    await page.getByRole("link", { name: "Wiki", exact: true }).click()
    await page.getByRole("link", { name: "Home", exact: true }).click()
    await expect(page.getByText("Background refresh result", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Refresh feed", exact: true })).toBeEnabled()
    expect(posts).toBe(1)
  } finally {
    release()
    if (beforeFeed === null) await storage.delete(FEED_CACHE_PATH)
    else await storage.write(FEED_CACHE_PATH, beforeFeed)
    expect((await request.post("/api/history/changes", { data: { changesetId } })).ok()).toBe(true)
  }
})
