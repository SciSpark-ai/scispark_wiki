import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { runFeed, FEED_CACHE_PATH } from "../src/lib/skills/feed"
import { MockProvider } from "../src/lib/llm/mock-provider"
import { FEEDBACK_PATH } from "../src/lib/recommendation/contract"
import type { LLMResult } from "../src/lib/llm/types"

const structured = (json: unknown): LLMResult => ({ text: JSON.stringify(json), json, usage: { inputTokens: 10, outputTokens: 10 }, model: "gpt-5.4-mini", provider: "openai", stopReason: "end_turn" })

test("recommendation preferences, real pipeline output, feedback and History undo", async ({ page, request }, testInfo) => {
  const path = process.env.SCISPARK_E2E_VAULT_PATH
  if (!path) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(path)
  const changes: string[] = []
  const beforeFeed = await storage.read(FEED_CACHE_PATH)
  const beforeTheme = (await (await request.get("/api/settings")).json()).ui.theme
  try {
    expect((await request.put("/api/settings", { data: { ui: { theme: "light" } } })).ok()).toBe(true)
    const created = await request.post("/api/profile", { data: { name: "Radar Tester", role: "Researcher", fields: "Neuroscience", topics: "auditory attention", feedPrefs: "", recommendations: { diversity: "balanced", learnFromFeedback: true, resetAt: null } } })
    expect(created.status()).toBe(201)
    changes.push((await created.json()).changesetId)
    const now = new Date()
    const strategy = { queries: [{ source: "pubmed", query: "auditory attention", rationale: "Declared interest" }] }
    const assessment = { index: 0, question: { grade: 4, evidence: "Auditory attention" }, topic: { grade: 4, evidence: "Auditory attention" }, approach: { grade: null, evidence: "" }, matches: [{ topic: "auditory attention", evidence: "Auditory attention" }], excluded: false }
    // Run actual orchestration/scoring/cache code. Replace only paid AI and public
    // literature retrieval with deterministic fixtures, not the feed or feedback UI.
    const feed = await runFeed(storage, { now: () => now,
      providerOverride: { strong: new MockProvider([structured(strategy)]), fast: new MockProvider([structured({ assessments: [assessment] })]) },
      searchFn: async () => [{ ids: { doi: "10.1234/recommendation-fixture" }, title: "Auditory attention recommendation fixture", abstract: "Auditory attention measured using EEG in children.", date: now.toISOString().slice(0, 10), source: "pubmed", authors: [], fields: [] }],
    })
    expect(feed.recommendation?.status).toBe("ranked")
    const cachedFeed = await storage.read(FEED_CACHE_PATH)
    const paperHeading = page.getByRole("heading", { name: "Auditory attention recommendation fixture", exact: true })
    const paperCard = page.getByRole("link").filter({ has: paperHeading })
    await page.goto("/")
    await expect(page.getByText("Auditory attention recommendation fixture", { exact: true })).toBeVisible()
    await page.getByText("Recommendation details", { exact: true }).click()
    await expect(page.getByText(/not a probability/)).toBeVisible()
    await expect(page.getByText("Unknown · neutral")).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("recommendation-light.png"), fullPage: true })
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/feedback") && r.request().method() === "POST")
    await page.getByRole("button", { name: "Less like this", exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(paperHeading).toBeVisible()
    const question = page.getByRole("dialog", { name: /Paper feedback with/ })
    await expect(question.getByText("What missed the mark?", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("sparky-feedback-desktop.png"), fullPage: true })
    await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await question.getByRole("radio", { name: "Not the method I need", exact: true }).check()
    await question.getByRole("textbox").fill("I need adult EEG studies, not pediatric studies.")
    await expect(question.getByRole("button", { name: "Save preference", exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("sparky-feedback-mobile.png"), fullPage: true })
    const refined = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/feedback") && r.request().method() === "POST")
    await question.getByRole("textbox").press("Enter")
    expect((await refined).status()).toBe(200)
    await expect(question.getByRole("status")).toContainText("saved this to your feed memory")
    await question.getByRole("button", { name: "Done", exact: true }).click()
    await expect(paperHeading).toBeVisible()
    expect(JSON.parse((await storage.read(FEEDBACK_PATH))!).entries[0]).toMatchObject({ reason: "wrong_method", note: "I need adult EEG studies, not pediatric studies.", abstract: "Auditory attention measured using EEG in children." })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.reload()
    await expect(paperHeading).toBeVisible()
    expect(await storage.read(FEED_CACHE_PATH)).toBe(cachedFeed)
    await page.goto("/settings?section=recommendations")
    await expect(page.getByRole("region", { name: "Saved feed memory" })).toContainText("I need adult EEG studies, not pediatric studies.")
    await expect(page.getByRole("region", { name: "Saved feed memory" })).toContainText("Method / population preference · Related papers only")
    const personalized = await runFeed(storage, { now: () => new Date(),
      providerOverride: { strong: new MockProvider([structured(strategy)]), fast: new MockProvider([structured({ assessments: [{ ...assessment,
        memoryMatches: [{ paperKey: "doi:10.1234/recommendation-fixture", facet: "approach", effect: "reduce", match: "close", candidateEvidence: "EEG in children", memoryEvidence: "EEG in children" }],
      }] })]) },
      searchFn: async () => [feed.items[0].paper],
    })
    expect(personalized.recommendation?.memoryStatus).toBe("checked")
    expect(personalized.items[0].ranking?.feedbackAdjustment).toBeLessThan(-7.9)
    await page.goto("/")
    await page.getByText("Recommendation details", { exact: true }).click()
    const appliedMemory = page.getByRole("region", { name: "Applied feed memory" })
    await expect(appliedMemory).toContainText("Method / population")
    await expect(appliedMemory).toContainText("Saved evidence: “EEG in children”")
    await expect(appliedMemory).toContainText("Paper evidence: “EEG in children”")
    await page.screenshot({ path: testInfo.outputPath("applied-memory-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(appliedMemory).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("applied-memory-mobile.png"), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 800 })
    await storage.write(FEED_CACHE_PATH, cachedFeed!)
    await page.goto("/history?tab=changes")
    const feedback = page.locator("article").filter({ hasText: "recommendation-feedback" }).first()
    page.once("dialog", (dialog) => void dialog.accept())
    await feedback.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(feedback).toContainText("reverted")
    const initialFeedback = page.locator("article").filter({ hasText: "recommendation-feedback" }).nth(1)
    page.once("dialog", (dialog) => void dialog.accept())
    await initialFeedback.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(initialFeedback).toContainText("reverted")
    expect(await storage.read(FEEDBACK_PATH)).toBeNull()
    await page.goto("/")
    await expect(page.getByText("Auditory attention recommendation fixture", { exact: true })).toBeVisible()
    const skippedSave = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/feedback") && r.request().method() === "POST")
    await page.getByRole("button", { name: "Less like this", exact: true }).click()
    const skipped = await (await skippedSave).json()
    changes.push(skipped.changesetId)
    await question.getByRole("button", { name: "Skip", exact: true }).click()
    expect(JSON.parse((await storage.read(FEEDBACK_PATH))!).entries[0].reason).toBe("less_like_this")
    await expect(question).toBeHidden()
    await expect(paperHeading).toBeVisible()
    await page.reload()
    await expect(paperHeading).toBeVisible()
    // Only an explicit Dismiss hides the existing card. Undo restores the
    // preceding thumbs down, which must not hide it on reload either.
    await paperCard.getByRole("button", { name: "Feedback", exact: true }).click()
    const dismissed = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/feedback") && r.request().method() === "POST")
    await paperCard.getByRole("button", { name: "Dismiss", exact: true }).click()
    const dismissal = await dismissed
    expect(dismissal.status()).toBe(200)
    const { changesetId: dismissalId } = await dismissal.json()
    changes.push(dismissalId)
    await expect(paperHeading).toBeHidden()
    await page.reload()
    await expect(page.getByRole("heading", { name: "Your feed is empty" })).toBeVisible()
    expect((await request.post("/api/history/changes", { data: { changesetId: dismissalId } })).ok()).toBe(true)
    changes.pop()
    expect(JSON.parse((await storage.read(FEEDBACK_PATH))!).entries[0].reason).toBe("less_like_this")
    await page.reload()
    await expect(paperHeading).toBeVisible()
    expect(await storage.read(FEED_CACHE_PATH)).toBe(cachedFeed)
    await page.goto("/settings?section=recommendations")
    const dialog = page.getByRole("dialog", { name: "Settings" })
    await dialog.getByRole("radio", { name: /Exploratory/ }).check()
    await dialog.getByRole("checkbox", { name: /Learn from my explicit/ }).uncheck()
    await dialog.getByRole("button", { name: "Reset learned preferences on Save" }).click()
    const updated = page.waitForResponse((r) => r.url().endsWith("/api/profile") && r.request().method() === "PATCH")
    await dialog.getByRole("button", { name: "Save preferences" }).click()
    const response = await updated
    expect(response.status()).toBe(200)
    changes.push((await response.json()).changesetId)
    await page.reload()
    // Settings is a transient modal; its route deliberately redirects to Home.
    await page.goto("/settings?section=recommendations")
    await expect(dialog.getByRole("radio", { name: /Exploratory/ })).toBeChecked()
    await expect(dialog.getByRole("checkbox", { name: /Learn from my explicit/ })).not.toBeChecked()
    const persisted = (await (await request.get("/api/profile")).json()).profile.recommendations
    expect(persisted.resetAt).toBeTruthy()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dialog.getByRole("button", { name: "Save preferences" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("recommendation-mobile.png"), fullPage: true })
  } finally {
    await request.put("/api/settings", { data: { ui: { theme: beforeTheme } } })
    for (const changesetId of changes.reverse()) expect((await request.post("/api/history/changes", { data: { changesetId } })).ok()).toBe(true)
    if (beforeFeed === null) await storage.delete(FEED_CACHE_PATH)
    else await storage.write(FEED_CACHE_PATH, beforeFeed)
  }
})
