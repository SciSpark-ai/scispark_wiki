import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { runFeed, FEED_CACHE_PATH } from "../src/lib/skills/feed"
import { MockProvider } from "../src/lib/llm/mock-provider"
import type { LLMResult } from "../src/lib/llm/types"

const structured = (json: unknown): LLMResult => ({
  text: JSON.stringify(json), json, usage: { inputTokens: 10, outputTokens: 10 },
  model: "gpt-5.4-mini", provider: "openai", stopReason: "end_turn",
})

test("saved subfields guide the next Feed and produce a readable paper explanation", async ({ page, request }, testInfo) => {
  const path = process.env.SCISPARK_E2E_VAULT_PATH
  if (!path) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(path)
  const before = await (await request.get("/api/settings")).json()
  const beforeSources = (await (await request.get("/api/settings/paper-sources")).json()).enabledSources
  const beforeFeed = await storage.read(FEED_CACHE_PATH)
  const changes: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    const profile = await request.post("/api/profile", { data: {
      name: "Shared Fields Tester", role: "Researcher", fields: "Speech science",
      topics: "auditory attention", feedPrefs: "",
      recommendations: { diversity: "exploratory", learnFromFeedback: false, resetAt: null },
    } })
    expect(profile.status()).toBe(201); changes.push((await profile.json()).changesetId)
    expect((await request.put("/api/settings", { data: {
      trending: { fields: [], cadence: "weekly", anchors: [], anchorsOverridden: false },
      ui: { theme: "light" },
    } })).ok()).toBe(true)
    expect((await request.put("/api/settings/paper-sources", { data: { enabledSources: ["pubmed"] } })).ok()).toBe(true)
    await page.goto("/settings?section=trending")
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
    await dialog.getByRole("checkbox", { name: "Neuroscience", exact: true }).check()
    await dialog.locator("summary").filter({ hasText: "Neuroscience" }).click()
    await dialog.getByRole("checkbox", { name: "Cognitive Neuroscience", exact: true }).check()
    await expect(dialog.getByText("Your selections also guide Home Feed.", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog.getByRole("status")).toContainText("Saved.")

    const strong = new MockProvider([structured({ queries: [
      { source: "pubmed", query: "cognitive neuroscience auditory attention", rationale: "Selected subfield" },
    ] })])
    const fast = new MockProvider([structured({ assessments: [{
      index: 0, question: { grade: 3, evidence: "auditory attention" },
      topic: { grade: 4, evidence: "Cognitive neuroscience" }, approach: { grade: null, evidence: "" },
      matches: [{ topic: "cognitive neuroscience", evidence: "Cognitive neuroscience" }], excluded: false, memoryMatches: [],
    }] })])
    // Real settings, orchestration, scoring and cache. Only external AI and
    // literature calls are fixtures; the paper has no taxonomy identifiers.
    const feed = await runFeed(storage, { providerOverride: { strong, fast }, now: () => new Date(),
      searchFn: async (source, _query, _limit, opts) => {
        expect(source).toBe("pubmed")
        expect(opts).not.toHaveProperty("subfieldIds")
        return [{ ids: { doi: "10.1234/shared-field-fixture" }, title: "Cognitive neuroscience of auditory attention",
          abstract: "Cognitive neuroscience examines auditory attention with EEG experiments.",
          source: "pubmed", date: new Date().toISOString().slice(0, 10), fields: [], authors: [] }]
      },
    })
    for (const provider of [strong, fast]) {
      expect(provider.calls[0].req.messages[1].content).toContain('"label":"Cognitive Neuroscience"')
      expect(provider.calls[0].req.messages[1].content).toContain('"diversity":"exploratory"')
    }
    expect(feed.recommendation?.fieldPreferences?.[0].subfields[0].label).toBe("Cognitive Neuroscience")
    expect(feed.items).toHaveLength(1)
    await page.goto("/")
    const heading = page.getByRole("heading", { name: "Cognitive neuroscience of auditory attention", exact: true })
    const card = page.getByRole("link").filter({ has: heading })
    await expect(heading).toBeVisible()
    await card.getByText("Why this paper?", { exact: true }).click()
    await expect(card).toContainText("Selected for your interest in cognitive neuroscience.")
    await page.screenshot({ path: testInfo.outputPath("shared-field-feed.png"), fullPage: true })
    await page.reload()
    await expect(heading).toBeVisible()
    await expect(page.getByText("fieldPreferences", { exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/settings?section=trending")
    const sharedFieldsNote = dialog.getByText("Your selections also guide Home Feed.", { exact: true })
    await sharedFieldsNote.scrollIntoViewIfNeeded()
    await expect(sharedFieldsNote).toBeVisible()
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("shared-field-settings-phone.png") })
    expect(errors).toEqual([])
  } finally {
    await request.put("/api/settings", { data: { trending: before.trending,
      ui: { theme: before.ui.theme },
    } })
    await request.put("/api/settings/paper-sources", { data: { enabledSources: beforeSources } })
    for (const changesetId of changes.reverse()) expect((await request.post("/api/history/changes", { data: { changesetId } })).ok()).toBe(true)
    if (beforeFeed === null) await storage.delete(FEED_CACHE_PATH)
    else await storage.write(FEED_CACHE_PATH, beforeFeed)
  }
})
