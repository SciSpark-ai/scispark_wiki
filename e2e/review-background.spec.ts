import { expect, test } from "@playwright/test"
import { z } from "zod"
import { DEFAULT_ENGINES } from "../src/lib/engines/contracts"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { loadReview, reviewCheckpoint, updateReview } from "../src/lib/review/store"
import { listSessions } from "../src/lib/chat/session"
import { ReviewEvidenceSchema } from "../src/lib/review/contracts"
import { hashReviewData } from "../src/lib/review/budget"
import { PaperSnapshotSchema } from "../src/lib/chat/blocks"
import type { PaperRecord } from "../src/lib/papers/types"

const papers: PaperRecord[] = [
  { ids: { doi: "10.1000/positive" }, title: "Adult decoding positive fixture", abstract: "Among 30 adults, decoding improved with the tested method. Pediatric outcomes were not studied.", authors: [{ name: "A Fixture" }], fields: [], source: "openalex" },
  { ids: { doi: "10.1000/null" }, title: "Adult decoding null fixture", abstract: "Among 20 adults, decoding did not improve with the tested method.", authors: [{ name: "B Fixture" }], fields: [], source: "openalex" },
]

async function seedSources(storage: NodeFsVaultStorage, id: string) {
  const schema = z.object({ papers: z.array(PaperSnapshotSchema), warnings: z.array(z.string()) })
  await reviewCheckpoint(storage, id, "initial-search-v1", [{ source: "openalex", query: "adult decoding" }], schema, async () => ({ papers: [papers[0]], warnings: [] }))
  await reviewCheckpoint(storage, id, "gap-search-v1", [{ source: "openalex", query: "null adult decoding", gap: "Conflicting findings" }], schema, async () => ({ papers: [papers[1]], warnings: [] }))
  for (const [i, paper] of papers.entries()) {
    const paperId = `P${i + 1}`
    await reviewCheckpoint(storage, id, "acquire-v2", { paper, id: paperId }, ReviewEvidenceSchema.nullable(), async () => ({ id: paperId, paper, title: paper.title, text: paper.abstract!, access: "abstract" as const, locator: "Fixture abstract", hash: hashReviewData(paper.abstract!), retrievedAt: new Date().toISOString(), notes: [] }))
  }
}

for (const engine of ["codex", "claude-code"] as const) test(`${engine} review continues across navigation and reload, failures require explicit recovery`, async ({ page, request }, info) => {
  test.setTimeout(120_000)
  test.skip(!process.env.SCISPARK_CODEX_PATH?.includes("fixtures/engines/") || !process.env.SCISPARK_CLAUDE_PATH?.includes("fixtures/engines/"), "Deterministic engine fixtures required; never use real plan capacity")
  const root = process.env.SCISPARK_E2E_VAULT_PATH!
  if (!root.includes("scispark-e2e-")) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(root)
  const settingsBefore = await storage.read(".scispark/settings.json")
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  try {
    const saved = await request.put("/api/settings", { data: { patch: { engines: { ...DEFAULT_ENGINES, kind: engine } } } })
    expect(saved.ok()).toBe(true)
    await page.goto("/chat")
    await page.getByRole("button", { name: "Deep literature review", exact: true }).click()
    await page.locator("summary").filter({ hasText: "Search scope" }).click()
    for (const label of ["arXiv", "Semantic Scholar", "PubMed"]) await page.getByRole("checkbox", { name: label, exact: true }).uncheck()
    await page.getByRole("checkbox", { name: "OpenAlex", exact: true }).check()
    await page.getByLabel("Message Sparky").fill("Compare adult decoding methods FIXTURE_REVIEW_SLOW")
    await page.getByLabel("Message Sparky").press("Enter")
    await expect(page.getByRole("heading", { name: "Your review brief" })).toBeVisible()
    const chatUrl = page.url()
    const session = (await listSessions(storage)).find(s => s.id === new URL(chatUrl).pathname.split("/").at(-1))!
    const block = session.messages.flatMap(m => m.blocks ?? []).find(b => b.type === "review")!
    if (block.type !== "review") throw new Error("Missing persisted review")
    const id = block.runId
    const attemptsPath = `.scispark/reviews/${id}/engine-attempts.json`
    const attempts = async () => JSON.parse(await storage.read(attemptsPath) ?? "[]") as { step: string; state: string }[]
    // Replace public-source retrieval only; use real review routes, coordinator,
    // subprocesses, persisted checkpoints, usage accounting and report rendering.
    await seedSources(storage, id)
    // Checkpoint seeding changes the manifest revision; approve the fresh brief.
    await page.reload()
    await page.getByRole("button", { name: "Start review", exact: true }).click()
    await expect.poll(async () => (await attempts()).length).toBe(1)
    await page.goto("/history")
    expect((await loadReview(storage, id)).status).toBe("running")
    await page.goto(chatUrl)
    await expect(page.getByText(/You can leave this page; the review continues/)).toBeVisible()
    await page.reload()
    await expect(page.getByText(/You can leave this page; the review continues/)).toBeVisible()
    expect(await attempts()).toHaveLength(1)
    await page.screenshot({ path: info.outputPath(`${engine}-review-background.png`) })
    await expect.poll(async () => (await loadReview(storage, id)).status, { timeout: 60_000 }).toBe("completed")
    await expect(page.getByRole("button", { name: "Open report", exact: true }).first()).toBeVisible()
    const doneAttempts = await attempts()
    expect(doneAttempts.every(a => a.state === "settled")).toBe(true)
    expect(doneAttempts.filter(a => a.step === "answer-requirements-v1")).toHaveLength(1)
    await page.getByRole("button", { name: "Open report", exact: true }).first().click()
    await expect(page.getByRole("complementary", { name: "Review report" })).toContainText("Contrasting fixture findings")
    await page.screenshot({ path: info.outputPath(`${engine}-review-completed.png`) })
    await page.reload()
    expect(await attempts()).toEqual(doneAttempts)

    // An actual fixture CLI failure stays paused across reopen, without replay.
    const prepared = await request.post("/api/reviews", { data: { sessionId: `failure_${engine.replaceAll("-", "_")}`, operationId: "failure", question: "Compare adult decoding methods FIXTURE_NETWORK_FAILURE", sources: ["openalex"] } })
    expect(prepared.ok()).toBe(true)
    const failedRun = (await prepared.json()).run
    const approved = await request.post(`/api/reviews/${failedRun.id}`, { data: { action: "approve", revision: failedRun.revision } })
    expect(approved.ok()).toBe(true)
    await expect.poll(async () => (await loadReview(storage, failedRun.id)).status).toBe("paused")
    const failedAttempts = await storage.read(`.scispark/reviews/${failedRun.id}/engine-attempts.json`)
    await page.goto(`/chat/${failedRun.sessionId}`)
    await expect(page.getByRole("heading", { name: "Review needs attention" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Literature review" }).getByRole("alert")).toContainText("connection failed")
    await expect(page.getByRole("button", { name: "Acknowledge and resume" })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("button", { name: "Acknowledge and resume" })).toBeVisible()
    expect(await storage.read(`.scispark/reviews/${failedRun.id}/engine-attempts.json`)).toBe(failedAttempts)
    await page.getByRole("button", { name: "Acknowledge and resume" }).scrollIntoViewIfNeeded()
    await expect(page.getByRole("button", { name: "Acknowledge and resume" })).toBeInViewport()
    await page.screenshot({ path: info.outputPath(`${engine}-review-needs-attention.png`) })
    if (engine === "codex") {
      // Reproduce a saved review created with the previous, incorrect catalog.
      await updateReview(storage, failedRun.id, run => { run.brief.model.model = "gpt-6-astra" })
      await request.put("/api/settings", { data: { patch: { engines: { ...DEFAULT_ENGINES, kind: engine, models: { ...DEFAULT_ENGINES.models, codex: { ...DEFAULT_ENGINES.models.codex, strong: "gpt-6-astra" } } } } } })
      await page.reload()
      await expect(page.getByRole("region", { name: "Literature review" }).getByRole("alert")).toContainText("does not list gpt-6-astra")
      await expect(page.getByRole("button", { name: "Acknowledge and resume" })).toBeDisabled()
      expect(await storage.read(`.scispark/reviews/${failedRun.id}/engine-attempts.json`)).toBe(failedAttempts)
      await page.screenshot({ path: info.outputPath("codex-review-unavailable-model.png") })
      // Change the selected model through the real UI, then explicitly approve
      // the updated brief without losing the original uncertain attempt.
      await page.getByRole("button", { name: "Choose model", exact: true }).click()
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible()
      await page.getByRole("combobox", { name: "Codex analysis model", exact: true }).selectOption("gpt-5.6-terra")
      expect(await page.getByRole("combobox", { name: "Codex analysis model", exact: true }).locator('option[value="gpt-6-astra"]').count()).toBe(0)
      await page.getByRole("button", { name: "Save models", exact: true }).click()
      await expect(page.getByRole("status").filter({ hasText: "Models saved for new requests" })).toBeVisible()
      expect(await storage.read(`.scispark/reviews/${failedRun.id}/engine-attempts.json`)).toBe(failedAttempts)
      await seedSources(storage, failedRun.id)
      await page.getByRole("button", { name: "Close settings", exact: true }).click()
      await page.reload()
      await page.getByRole("button", { name: "Edit brief", exact: true }).click()
      await page.getByRole("button", { name: "Update brief", exact: true }).click()
      await expect(page.getByRole("button", { name: "Acknowledge and start review" })).toBeVisible()
      await page.getByRole("button", { name: "Acknowledge and start review" }).click()
      await expect.poll(async () => (await loadReview(storage, failedRun.id)).status, { timeout: 60_000 }).toBe("completed")
      const recovered = JSON.parse((await storage.read(`.scispark/reviews/${failedRun.id}/engine-attempts.json`))!)
      expect(recovered[0].state).toBe("acknowledged")
      expect(recovered.slice(1).every((attempt: { state: string }) => attempt.state === "settled")).toBe(true)
      await expect(page.getByRole("button", { name: "Open report", exact: true }).first()).toBeVisible()
      await page.screenshot({ path: info.outputPath("codex-review-recovered-after-model-change.png") })
    }
    expect(errors).toEqual([])
  } finally {
    if (settingsBefore) await storage.write(".scispark/settings.json", settingsBefore)
  }
})
