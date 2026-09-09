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
      searchFn: async () => [
        { ids: { doi: "10.1234/referee-fixture" }, title: "Reviewer #1 (Public review)", publicationTypes: ["peer-review"], abstract: "Auditory attention measured using EEG in children.", date: now.toISOString().slice(0, 10), source: "pubmed", authors: [], fields: [] },
        { ids: { doi: "10.1234/recommendation-fixture" }, title: "Auditory attention recommendation fixture", abstract: "Auditory attention measured using EEG in children.", date: now.toISOString().slice(0, 10), source: "pubmed", authors: [], fields: [] },
      ],
    })
    expect(feed.recommendation?.status).toBe("ranked")
    expect(feed.items.map((item) => item.paper.title)).toEqual(["Auditory attention recommendation fixture"])
    // Replay the legacy warning shown in the human walkthrough. Opening Home
    // must not present a saved refresh diagnostic as a fresh source outage.
    const legacyFeed = { ...feed, recommendation: { ...feed.recommendation!,
      warnings: [...feed.recommendation!.warnings, "s2: Source unavailable or timed out", "pubmed: Source unavailable or timed out"],
    } }
    await storage.write(FEED_CACHE_PATH, JSON.stringify(legacyFeed))
    const cachedFeed = await storage.read(FEED_CACHE_PATH)
    const paperHeading = page.getByRole("heading", { name: "Auditory attention recommendation fixture", exact: true })
    const paperCard = page.getByRole("link").filter({ has: paperHeading })
    await page.goto("/")
    await expect(page.getByText("Auditory attention recommendation fixture", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Radar Tester/ })).toBeVisible()
    await expect(page.getByText(/exploration · edit preferences/)).toHaveCount(0)
    await expect(page.getByRole("link", { name: /edit preferences/ })).toHaveCount(0)
    await expect(page.getByText("s2: Source unavailable or timed out", { exact: true })).toHaveCount(0)
    const coverage = page.getByText("Some searches were incomplete on the last refresh", { exact: true })
    await expect(coverage).toBeVisible()
    const historicalExplanation = page.getByText("This is a record of that refresh, not a live source-status check.", { exact: true })
    await expect(historicalExplanation).toBeHidden()
    await coverage.click()
    await expect(historicalExplanation).toBeVisible()
    await expect(page.getByText("Semantic Scholar:", { exact: true })).toBeVisible()
    await expect(page.getByText("PubMed:", { exact: true })).toBeVisible()
    await coverage.click()
    await expect(page.getByText("Reviewer #1 (Public review)", { exact: true })).toHaveCount(0)
    await expect(paperCard.getByRole("button", { name: "Feedback", exact: true })).toHaveCount(0)
    const band = paperCard.locator(":scope > div").first()
    await expect(band).toHaveCSS("border-top-width", "0px")
    await expect(band).toHaveCSS("overflow", "hidden")
    await expect(band.locator('[aria-hidden="true"]')).toHaveCSS("background-image", /\/textures\/grain\.png/)
    await expect(band.locator('[aria-hidden="true"]')).toHaveCSS("pointer-events", "none")
    await paperCard.getByText("Why this paper?", { exact: true }).click()
    await expect(paperCard).toContainText("Selected for your interest in auditory attention.")
    await expect(paperCard).not.toContainText("not a probability")
    await expect(paperCard).not.toContainText("Unknown · neutral")
    await page.screenshot({ path: testInfo.outputPath("recommendation-light.png"), fullPage: true })
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/feedback") && r.request().method() === "POST")
    await page.getByRole("button", { name: "Less like this", exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(paperHeading).toBeVisible()
    const question = page.getByRole("dialog", { name: /Paper feedback with/ })
    await expect(question.getByText("What missed the mark?", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("sparky-feedback-desktop.png"), fullPage: true })
    await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click()
    await expect(band).toHaveCSS("border-top-width", "0px")
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
    await expect(paperCard.getByRole("button", { name: "Less like this", exact: true })).toHaveAttribute("aria-pressed", "true")
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
    // The server record retains the evidence/adjustment; the card uses prose.
    expect(personalized.items[0].ranking?.memoryEffects?.[0]).toMatchObject({ facet: "approach", effect: "reduce" })
    await paperCard.getByText("Why this paper?", { exact: true }).click()
    const explanation = paperCard.locator("details")
    await expect(explanation).toContainText("Based on the title and abstract, not a full-text review.")
    await expect(paperCard).not.toContainText("Saved evidence:")
    await page.screenshot({ path: testInfo.outputPath("applied-memory-desktop.png"), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(explanation).toBeVisible()
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
    // Identical, persisted controls on the detail page. Switch and clear votes
    // without a popup for positive feedback, without hiding the paper.
    await paperHeading.click()
    await expect(page).toHaveURL(/\/paper\//)
    const down = page.getByRole("button", { name: "Less like this", exact: true })
    const up = page.getByRole("button", { name: "More like this", exact: true })
    await expect(down).toHaveAttribute("aria-pressed", "true")
    // Feedback shares the action row and stays at its right edge. On a
    // phone the primary actions wrap naturally without horizontal overflow.
    const actionRow = page.getByRole("group", { name: "Paper actions", exact: true })
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      await actionRow.scrollIntoViewIfNeeded()
      const rowBox = (await actionRow.boundingBox())!
      const upBox = (await up.boundingBox())!
      const downBox = (await down.boundingBox())!
      expect(Math.abs(upBox.y - downBox.y)).toBeLessThan(1)
      expect(Math.abs(downBox.x + downBox.width - rowBox.x - rowBox.width)).toBeLessThan(1)
      if (viewport.width > 1000) {
        const readBox = (await actionRow.getByRole("button", { name: "Read full text", exact: true }).boundingBox())!
        expect(upBox.x).toBeGreaterThan(readBox.x + readBox.width)
        expect(Math.abs(upBox.y + upBox.height / 2 - readBox.y - readBox.height / 2)).toBeLessThan(1)
      }
      await expect(up).toBeInViewport()
      await expect(down).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`paper-actions-${viewport.width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole("button", { name: "Switch to light mode", exact: true }).click()
    await actionRow.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath("paper-actions-light.png"), fullPage: true })
    await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click()
    const switched = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/feedback") && r.request().method() === "POST")
    await up.click()
    changes.push((await (await switched).json()).changesetId)
    await expect(up).toHaveAttribute("aria-pressed", "true")
    await expect(down).toHaveAttribute("aria-pressed", "false")
    await expect(question).toBeHidden()
    await page.reload()
    await expect(up).toHaveAttribute("aria-pressed", "true")
    const cleared = page.waitForResponse((r) => r.url().endsWith("/api/recommendations/feedback") && r.request().method() === "DELETE")
    await up.click()
    changes.push((await (await cleared).json()).changesetId)
    await expect(up).toHaveAttribute("aria-pressed", "false")
    await expect(down).toHaveAttribute("aria-pressed", "false")
    await page.goto("/")
    await expect(paperHeading).toBeVisible()
    await expect(paperCard.getByRole("button", { name: "More like this", exact: true })).toHaveAttribute("aria-pressed", "false")
    // Save state must also survive detail navigation and a full reload.
    // Enrichment is independent of save/feedback acceptance.
    await page.route("**/api/skills/enrich", (route) => route.fulfill({ json: { result: { status: "skipped", costUsd: 0 } } }))
    const savedPaper = page.waitForResponse((r) => r.url().endsWith("/api/vault/changeset") && r.request().method() === "POST")
    await paperCard.getByRole("button", { name: "Save", exact: true }).click()
    const saveResponse = await savedPaper
    expect(saveResponse.ok()).toBe(true)
    changes.push(saveResponse.request().postDataJSON().changeset.id)
    await expect(paperCard.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute("aria-pressed", "true")
    await paperHeading.click()
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute("aria-pressed", "true")
    await page.reload()
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute("aria-pressed", "true")
    await page.goto("/")
    await expect(paperCard.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute("aria-pressed", "true")
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
