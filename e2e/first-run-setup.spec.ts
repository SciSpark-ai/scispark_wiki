import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { FEED_CACHE_PATH, type FeedResult } from "../src/lib/skills/feed"

const ANSWERS = {
  name: "Ada",
  role: "Research fellow",
  fields: "Auditory neuroscience",
  topics: "Language development",
  feedPrefs: "Recent methods papers",
}

const FEED: FeedResult = {
  generatedAt: new Date().toISOString(),
  items: [{
    paper: {
      ids: {}, title: "First-run fixture paper", authors: [{ name: "Ada Researcher" }],
      abstract: "A deterministic first-feed result for UI acceptance.",
      year: 2026, venue: "SciSpark Preview", fields: ["Neuroscience"], source: "s2",
    },
    score: 90, whyThis: "A methods paper.", whyYou: "Matches your research field.", whyNow: "Recently published.",
  }],
  costUsd: 0,
  strategy: { queries: [{ source: "s2", query: "auditory neuroscience", rationale: "Matches the profile." }] },
  stats: { retrieved: 1, ranked: 1 },
}

for (const entry of ["new connection", "saved connection"] as const) {
  test(`first feed starts automatically with a ${entry} and reaches the feed`, async ({ page, request }, testInfo) => {
    const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH
    if (!vaultPath) throw new Error("Disposable E2E vault is required")
    const storage = new NodeFsVaultStorage(vaultPath)
    expect(await storage.read(FEED_CACHE_PATH)).toBeNull()
    let changesetId: string | undefined
    let feedRequests = 0
    let consolidationRequests = 0
    let releaseFeed!: () => void
    const feedGate = new Promise<void>((resolve) => { releaseFeed = resolve })

    // Exercise the real setup components, profile/settings APIs, and BYOK ping
    // against the local mock provider. Isolate external literature retrieval at
    // the feed transport boundary; this test targets auto-start, not ranking.
    await page.route("**/api/skills/consolidate", async (route) => {
      consolidationRequests++
      await route.fulfill({ json: { result: { status: "skipped", costUsd: 0 } } })
    })
    await page.route("**/api/skills/feed/refresh", async (route) => {
      feedRequests++
      await feedGate
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: [
          ...["strategy", "retrieval", "rank", "rerank"].map((stage) => ({ type: "progress", stage })),
          { type: "result", payload: FEED },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      })
    })

    try {
      await page.emulateMedia({ reducedMotion: "reduce" })
      if (entry === "new connection") {
        const cleared = await request.put("/api/settings", { data: { patch: { keys: { openai: "" } } } })
        expect(cleared.ok()).toBe(true)
        await page.goto("/onboarding")
        await expect(page).toHaveURL(/\/setup$/)
        expect(feedRequests).toBe(0)
        await page.getByPlaceholder("Paste your API key").fill("e2e-local-only-key")
        await page.getByRole("button", { name: "Connect & continue" }).click()
        await expect(page).toHaveURL(/\/onboarding$/)
        const composer = page.getByRole("textbox", { name: "Your reply to Sparky" })
        for (const answer of ["Ada", "Postdoc in auditory neuroscience", "Language development and hearing", "Mostly hearing research, with some computational methods from nearby fields", "No, don’t learn from my feedback"]) {
          await composer.fill(answer)
          const turn = page.waitForResponse((response) => response.url().endsWith("/api/onboarding") && response.request().method() === "POST")
          await composer.press("Enter")
          await (await turn).finished()
          await expect(composer).toBeEnabled()
          expect(feedRequests).toBe(0)
        }
        const review = page.getByRole("form", { name: "Review your research profile" })
        await expect(review).toBeVisible()
        expect((await request.get("/api/profile")).status()).toBe(404)
        const confirmation = page.waitForResponse((response) => response.url().endsWith("/api/onboarding") && response.request().postDataJSON()?.action === "confirm")
        await review.getByRole("button", { name: "Confirm profile & find papers" }).click()
        changesetId = (await (await confirmation).json()).changesetId
        expect((await (await request.get("/api/profile")).json()).profile.recommendations).toMatchObject({ diversity: "exploratory", learnFromFeedback: false })
      } else {
        const profileResponse = await request.post("/api/profile", { data: ANSWERS })
        expect(profileResponse.status()).toBe(201)
        changesetId = (await profileResponse.json()).changesetId
        await page.goto("/setup")
      }

      await expect.poll(() => feedRequests).toBe(1)
      expect(consolidationRequests).toBe(0)
      await expect(page.getByRole("status").filter({ hasText: "Checking research memory" })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath("initialization-started.png") })

      // Seed the cache a successful feed route would persist before completion.
      await storage.write(FEED_CACHE_PATH, JSON.stringify(FEED))
      releaseFeed()
      await expect(page.getByRole("heading", { name: "Your research radar is ready." })).toBeVisible()
      await expect(page.getByText(/Sparky found 1 paper/)).toBeVisible()
      await page.getByRole("link", { name: "Open my feed" }).click()
      await expect(page.getByText("First-run fixture paper", { exact: true })).toBeVisible()
      await page.goto("/setup")
      await expect(page.getByRole("heading", { name: "Your research radar is ready." })).toBeVisible()
      expect(feedRequests).toBe(1)
      expect(consolidationRequests).toBe(0)
    } finally {
      releaseFeed()
      await storage.delete(FEED_CACHE_PATH)
      if (changesetId) {
        const undone = await request.post("/api/history/changes", { data: { changesetId } })
        expect(undone.ok()).toBe(true)
      }
      await storage.delete("profile/onboarding-conversation.json")
      // Restore only the disposable fixture key for the rest of the E2E suite.
      const restored = await request.put("/api/settings", { data: { patch: { keys: { openai: "e2e-local-only-key" } } } })
      expect(restored.ok()).toBe(true)
    }
  })
}
