import { expect, test } from "@playwright/test"
import { z } from "zod"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { loadReview, reviewCheckpoint, updateReview } from "../src/lib/review/store"
import { listSessions } from "../src/lib/chat/session"
import { ReviewEvidenceSchema } from "../src/lib/review/contracts"
import { hashReviewData } from "../src/lib/review/budget"
import { coverageDisplayMarkdown, renderAnswerCoverage } from "../src/lib/review/coverage"
import { PaperSnapshotSchema } from "../src/lib/chat/blocks"
import type { PaperRecord } from "../src/lib/papers/types"

const papers: PaperRecord[] = [
  { ids: { doi: "10.1000/positive" }, title: "Adult decoding positive fixture", abstract: "Among 30 adults, decoding improved with the tested method. Pediatric outcomes were not studied.", authors: [{ name: "A Fixture" }], fields: [], source: "openalex" },
  { ids: { doi: "10.1000/null" }, title: "Adult decoding null fixture", abstract: "Among 20 adults, decoding did not improve with the tested method.", authors: [{ name: "B Fixture" }], fields: [], source: "openalex" },
]
test("deep review approval, server pipeline, History, editable report, exports and mobile layout", async ({ page, request }, info) => {
  test.setTimeout(120_000)
  const root = process.env.SCISPARK_E2E_VAULT_PATH!
  if (!root.includes("scispark-e2e-")) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(root)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto("/chat")
  await page.getByLabel("Chat mode").selectOption("review")
  await page.getByRole("button", { name: "Search scope" }).click()
  for (const label of ["arXiv", "Semantic Scholar", "PubMed"]) await page.getByRole("checkbox", { name: label, exact: true }).uncheck()
  await page.getByRole("checkbox", { name: "OpenAlex", exact: true }).check()
  await page.getByLabel("Message Sparky").fill("Compare adult decoding methods")
  await page.getByLabel("Message Sparky").press("Enter")
  await expect(page.getByRole("heading", { name: "Your review brief" })).toBeVisible()
  await expect(page).toHaveURL(/\/chat\//)
  const chatUrl = page.url()
  await page.getByRole("button", { name: "Edit brief", exact: true }).click()
  await page.getByLabel("Input", { exact: true }).fill("0.75")
  await page.getByLabel("Output", { exact: true }).fill("3.75")
  await page.getByLabel("Cache reads (optional)", { exact: true }).fill("0.075")
  await page.getByRole("button", { name: "Update brief" }).click()
  await expect(page.getByRole("button", { name: "Update brief" })).toHaveCount(0)
  const session = (await listSessions(storage)).find((s) => s.messages.some((m) => m.blocks?.some((b) => b.type === "review")))!
  const block = session.messages.flatMap((m) => m.blocks ?? []).find((b) => b.type === "review")!
  if (block.type !== "review") throw new Error("Missing persisted brief")
  const runId = block.runId
  // Fixtures replace only external-index retrieval. The real HTTP approval,
  // coordinator, model transport, claim pipeline, metering and report remain live.
  const schema = z.object({ papers: z.array(PaperSnapshotSchema), warnings: z.array(z.string()) })
  await reviewCheckpoint(storage, runId, "initial-search-v1", [{ source: "openalex", query: "adult decoding" }], schema, async () => ({ papers: [papers[0]], warnings: [] }))
  await reviewCheckpoint(storage, runId, "gap-search-v1", [{ source: "openalex", query: "null adult decoding", gap: "Conflicting findings" }], schema, async () => ({ papers: [papers[1]], warnings: [] }))
  for (const [i, paper] of papers.entries()) {
    const id = `P${i + 1}`
    await reviewCheckpoint(storage, runId, "acquire-v2", { paper, id }, ReviewEvidenceSchema.nullable(), async () => ({ id, paper, title: paper.title, text: paper.abstract!, access: "abstract" as const, locator: "Fixture abstract", hash: hashReviewData(paper.abstract!), retrievedAt: new Date().toISOString(), notes: [] }))
  }
  await page.reload()
  expect((await loadReview(storage, runId)).status).toBe("awaiting-approval")
  const approvalResponse = page.waitForResponse((response) => response.url().endsWith(`/api/reviews/${runId}`) && response.request().method() === "POST")
  await page.getByRole("button", { name: "Start review" }).click()
  expect((await approvalResponse).ok()).toBe(true)
  await page.goto("/history") // Browser navigation must not own the run's lifetime.
  await expect.poll(async () => (await loadReview(storage, runId)).status, { timeout: 60_000 }).toBe("completed")
  // Seed a finished partial manifest; coordinator unit tests exercise actual
  // rejected audits. This checks the real retry control and version presentation.
  const partial = await updateReview(storage, runId, (r) => {
    r.status = "partial"; r.stage = "Some claims need review"; r.versions[0].verification = "needs-review"
  })
  await page.goto(chatUrl)
  await expect(page.getByRole("button", { name: "Retry source checks", exact: true }).first()).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath("partial-retry-mobile.png") })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole("button", { name: "Retry source checks", exact: true }).first().click()
  await expect.poll(async () => (await loadReview(storage, runId)).status, { timeout: 60_000 }).toBe("completed")
  expect((await loadReview(storage, runId)).versions[0]).toEqual(partial.versions[0])
  const done = await loadReview(storage, runId)
  // Grounding and coverage are independent outcomes in the rendered product.
  await updateReview(storage, runId, (r) => {
    r.status = "partial"; r.stage = "Draft ready with coverage gaps"
    r.versions.at(-1)!.answerCoverage = { status: "limited", requirements: [{ id: "R1", question: "What directly compares the methods?" }],
      facets: [{ requirementId: "R1", status: "missing", explanation: "No direct comparator in this reading set.", evidence: [], answerQuote: null }] }
    r.versions.at(-1)!.markdown = r.versions.at(-1)!.markdown.replace(/<!-- scispark-answer-coverage:start -->[\s\S]*?<!-- scispark-answer-coverage:end -->/, renderAnswerCoverage(r.versions.at(-1)!.answerCoverage!))
  })
  const attempts = JSON.parse((await storage.read(".scispark/usage/review-attempts.json"))!).length
  await page.goto(chatUrl)
  await page.getByRole("button", { name: "Open report", exact: true }).first().click()
  const report = page.getByRole("complementary", { name: "Review report" })
  await expect(report.getByRole("heading", { name: "Contrasting fixture findings" })).toBeVisible()
  await expect(report.getByText("Automated source checks passed", { exact: true })).toBeVisible()
  await expect(report.getByText("Answer coverage: limited. Essential parts of your question remain unresolved.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Retry source checks", exact: true })).toHaveCount(0)
  await expect(report.getByText("Among 20 adults", { exact: false }).first()).toBeVisible()
  await report.getByRole("link", { name: "P1", exact: true }).first().click()
  await expect(report.locator("#review-source-P1")).toHaveAttribute("open", "")
  await report.getByRole("heading", { name: "Contrasting fixture findings" }).scrollIntoViewIfNeeded()
  expect(JSON.parse((await storage.read(".scispark/usage/review-attempts.json"))!).length).toBe(attempts)
  await page.screenshot({ path: info.outputPath("review-desktop-light.png") })
  await expect(report).not.toContainText("scispark-answer-coverage:")
  await report.getByRole("button", { name: "Edit report" }).click()
  await expect(report.getByLabel("Edit review report")).not.toHaveValue(/scispark-answer-coverage:/)
  await report.getByLabel("Edit review report").fill(`${coverageDisplayMarkdown((await loadReview(storage, runId)).versions.at(-1)!.markdown)}\n\nHuman editing fixture.`)
  await report.getByRole("button", { name: "Save new version" }).click()
  await expect(report.getByText("Edited claims need source checks", { exact: true })).toBeVisible()
  await expect(report.getByText("Answer coverage: not assessed for this version.", { exact: true })).toBeVisible()
  await expect(report.getByText("Not assessed for this edited version.", { exact: false })).toBeVisible()
  const edited = await loadReview(storage, runId)
  expect(edited.versions).toHaveLength(3)
  expect(edited.versions[0].markdown).toBe(done.versions[0].markdown)
  const exported = await request.get(`/api/reviews/${runId}/export?version=${edited.versions[2].id}&format=bibtex`)
  expect(exported.ok()).toBe(true); expect(await exported.text()).toContain("10.1000/null")
  await report.getByRole("button", { name: "Add to knowledge base" }).click()
  await expect(report.getByRole("status").filter({ hasText: "Undo is available" })).toBeVisible()
  await page.getByRole("button", { name: /Switch to dark mode/ }).click()
  await page.screenshot({ path: info.outputPath("review-desktop-dark.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath("review-mobile-dark.png") })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2)).toBe(true)
  await report.getByRole("button", { name: "Close report" }).click()
  await expect(page.getByLabel("Message Sparky")).toBeInViewport()
  expect(errors).toEqual([])
})
