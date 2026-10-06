import { expect, test } from "@playwright/test"
import { randomUUID, createHash } from "node:crypto"
import { realpath, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { workflowFixture } from "../src/lib/workflows/__tests__/fixtures"
import { writeRun, appendEvent } from "../src/lib/workflows/store"
import { NATIVE_TOOL_MANIFESTS } from "../src/lib/extensions/native-catalog"
import { ReviewRunSchema } from "../src/lib/review/contracts"
import { nativeStepId } from "../src/lib/extensions/native-adapters"
import { publishArtifact } from "../src/lib/workflows/artifacts"

test("saved runs stay read-only across navigation, with desktop/mobile choices, citations, downloads and reversible saves", async ({ page, request }, info) => {
  const vault = await realpath(process.env.SCISPARK_E2E_VAULT_PATH!), storage = new NodeFsVaultStorage(vault)
  const session = await (await request.get("/api/local-profiles/session")).json()
  await request.post("/api/profile", { data: { name: "Ada", role: "Researcher", fields: "Neuroscience", topics: "Speech", feedPrefs: "Methods" } })
  const runtimeRoot = join(process.env.SCISPARK_E2E_RUN_DIR!, "profiles", "extensions"); await mkdir(runtimeRoot, { recursive: true })
  const f = workflowFixture(), ctx = { ...f.ctx, vaultPath: vault, vaultId: createHash("sha256").update(vault).digest("hex"), profileId: session.profile.id, runtimeRoot, storage }
  const run = { ...f.run, id: randomUUID(), profileId: ctx.profileId, vaultId: ctx.vaultId, status: "running" as const, usage: { modelCalls: 3, commandCalls: 0, activeSeconds: 12, costUsd: null }, allowance: { ...f.run.allowance, costUsd: null }, model: { ...f.run.model, engine: "codex" as const } }
  await writeRun(ctx, run)
  const journalPath = `.scispark/tool-runs/${run.id}/journal.json`
  const journal = { schemaVersion: 1, runId: run.id, profileId: ctx.profileId, vaultId: ctx.vaultId, status: "running", lease: { id: randomUUID(), processId: randomUUID(), pid: process.pid, expiresAt: Date.now() + 3600000 }, actions: [] }
  await storage.write(journalPath, JSON.stringify(journal))
  const artifact = await publishArtifact(ctx, run.id, { kind: "markdown", title: "Saved evidence report", mediaType: "text/markdown", sourceRefs: ["https://doi.org/10.1234/fixture"], bytes: new TextEncoder().encode("# Evidence report\n\nA **saved finding** with source limitations.\n\nThis is a disposable browser fixture.") })
  await publishArtifact(ctx, run.id, { kind: "bibtex", title: "Source bibliography", mediaType: "application/x-bibtex", sourceRefs: ["https://doi.org/10.1234/fixture"], bytes: new TextEncoder().encode("@article{fixture, title={Fixture source}, year={2026}}") })
  await publishArtifact(ctx, run.id, { kind: "papers", title: "Matching papers", mediaType: "application/json", sourceRefs: ["https://doi.org/10.1234/fixture"], bytes: new TextEncoder().encode(JSON.stringify({ query: "speech", plan: { interpretation: "Fixture search", sort: "relevance", fromDate: null, queries: [] }, items: [{ paper: { ids: { doi: "10.1234/fixture" }, title: "Fixture speech evidence", authors: [{ name: "Ada Researcher" }], year: 2026, fields: ["Speech"], source: "s2" }, score: 1, whyMatch: "Relevant source", foundBy: [] }], stats: { retrieved: 1, deduplicated: 1 }, costUsd: null, warnings: [] })) })
  await appendEvent(ctx, run.id, { type: "text", text: JSON.stringify({ type: "text", text: "## Research in progress\n\nComparing **sources" }) })
  await appendEvent(ctx, run.id, { type: "text", text: JSON.stringify({ type: "progress", stage: "ranking" }) })
  let starts = 0, mutations = 0
  page.on("request", req => { if (req.method() === "POST" && /\/api\/tools\/runs$/.test(req.url())) starts++; if (req.method() === "POST" && req.url().includes("/actions")) mutations++ })
  await page.goto(`/tools/runs/${run.id}`)
  await expect(page.getByText("3 calls used", { exact: true })).toBeVisible()
  await expect(page.getByText("Research in progress", { exact: true })).toBeVisible()
  await expect(page.getByText("Working", { exact: true })).toBeVisible()
  await expect(page.getByText(/\{"type":"progress"/)).toHaveCount(0)
  await expect(page.getByText("Ranking papers", { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("run-desktop.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("link", { name: "All runs", exact: true }).click()
  await expect(page.getByRole("region", { name: "Research runs" })).toContainText("review")
  await page.getByRole("region", { name: "Research runs" }).getByRole("link").first().click()
  await expect(page.getByText("Working", { exact: true })).toBeVisible(); expect(starts).toBe(0); expect(mutations).toBe(0)
  await page.getByRole("button", { name: "Add to wiki" }).click(); await expect(page.getByText(/Added to wiki/)).toBeVisible()
  const firstSaves = (await (await request.get(`/api/tools/runs/${run.id}`)).json()).result.observation.saves
  await publishArtifact(ctx, run.id, { kind: "markdown", title: "Later evidence note", mediaType: "text/markdown", sourceRefs: [], bytes: new TextEncoder().encode("A later saved result.") })
  await expect(page.getByRole("heading", { name: "Later evidence note", exact: true })).toBeVisible()
  await expect(page.getByText(/Added to wiki/)).toHaveCount(0)
  await page.getByRole("button", { name: "Add new results to wiki" }).click(); await expect(page.getByText(/Added to wiki/)).toBeVisible()
  const nextSaves = (await (await request.get(`/api/tools/runs/${run.id}`)).json()).result.observation.saves
  expect(nextSaves).toHaveLength(firstSaves.length + 1)
  expect(nextSaves.at(-1).artifactIds.some((id: string) => firstSaves[0].artifactIds.includes(id))).toBe(false)
  expect(new Set(nextSaves.map((save: { changesetId: string }) => save.changesetId)).size).toBe(nextSaves.length)
  await appendEvent(ctx, run.id, { type: "text", text: "## Research complete\n\nFinal **source-grounded** report retained." })
  await storage.write(journalPath, JSON.stringify({ ...journal, status: "completed", lease: null }))
  await appendEvent(ctx, run.id, { type: "status", status: "completed" })
  await expect(page.getByText("Completed", { exact: true })).toBeVisible()
  await expect(page.getByText("source-grounded", { exact: true })).toBeVisible()
  const report = page.locator("article").filter({ has: page.getByRole("heading", { name: "Saved evidence report" }) })
  await report.getByRole("button", { name: "Preview", exact: true }).click(); await expect(report.getByText("saved finding", { exact: true })).toBeVisible()
  await report.getByText("Sources (1)", { exact: true }).click(); await expect(report.getByRole("link", { name: "https://doi.org/10.1234/fixture" })).toHaveAttribute("href", "https://doi.org/10.1234/fixture")
  const papers = page.locator("article").filter({ has: page.getByRole("heading", { name: "Matching papers", exact: true }) })
  await papers.getByRole("button", { name: "Preview", exact: true }).click(); await expect(papers.getByText("Fixture speech evidence", { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent("download"); await report.getByRole("button", { name: "Download markdown" }).click(); const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`artifact-${artifact.id}.md`)
  const response = await request.get(`/api/tools/runs/${run.id}/artifacts/${artifact.id}`)
  expect(response.headers()["content-disposition"]).toContain("attachment"); expect(response.headers()["x-content-type-options"]).toBe("nosniff"); expect(response.headers()["cache-control"]).toBe("no-store")
  const foreign = await request.get(`/api/tools/runs/${run.id}/artifacts/${artifact.id}`, { headers: { "x-scispark-profile": randomUUID() } }); expect(foreign.status()).toBe(409)
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" })
  await page.screenshot({ path: info.outputPath("run-phone.png"), fullPage: true, animations: "disabled" }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole("link", { name: "Review or undo in History" }).click(); page.once("dialog", dialog => dialog.accept())
  const change = page.locator("article").filter({ hasText: "workflow:review" }).first(); await change.getByRole("button", { name: "Undo", exact: true }).click(); await expect(change).toContainText("Already undone.")
  expect((await storage.list("wiki/notes/")).some(path => path.includes(artifact.id))).toBe(true)
  const choiceId = randomUUID(), tool = NATIVE_TOOL_MANIFESTS[1].ref
  await storage.write(journalPath, JSON.stringify({ ...journal, status: "waiting_for_choice", lease: null }))
  await storage.write(`.scispark/tool-runs/${run.id}/host-continuation.json`, JSON.stringify({ schemaVersion: 1, runId: run.id, completed: false, frames: [{ id: run.id, tool: run.tool, input: {}, turn: 0, observations: [], publicText: "" }], choices: [], waitingChoice: { id: choiceId, parentFrameId: run.id, slotId: "methods", candidates: [tool, NATIVE_TOOL_MANIFESTS[2].ref] } }))
  await appendEvent(ctx, run.id, { type: "text", text: "## Saved partial evidence\n\nChoose a supporting skill to continue comparing sources." })
  await page.goto(`/tools/runs/${run.id}`)
  await expect(page.getByRole("button", { name: "Find papers", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Deep review", exact: true })).toBeVisible()
  await expect(page.getByText("Choose a supporting skill", { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("chooser-phone.png"), fullPage: true, animations: "disabled" }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: info.outputPath("chooser-desktop.png"), fullPage: true, animations: "disabled" })
  expect(starts).toBe(0); expect(mutations).toBe(0)
})


test("Tools-origin wording recovery opens the existing report read-only and requires Stop before a new explicit revision", async ({ page, request }, info) => {
  const vault = await realpath(process.env.SCISPARK_E2E_VAULT_PATH!), storage = new NodeFsVaultStorage(vault)
  const session = await (await request.get("/api/local-profiles/session")).json(), f = workflowFixture()
  const ctx = { ...f.ctx, vaultPath: vault, vaultId: createHash("sha256").update(vault).digest("hex"), profileId: session.profile.id, storage }
  const run = { ...f.run, id: randomUUID(), sessionId: undefined, profileId: ctx.profileId, vaultId: ctx.vaultId, status: "needs_attention" as const }
  await writeRun(ctx, run)
  const reviewId = `review_${randomUUID().replaceAll("-", "")}`, stepId = nativeStepId(run.id, "revision-0")
  const review = ReviewRunSchema.parse({ version: 1, id: reviewId, sessionId: run.id, conversationId: null, status: "paused", stage: "Saved draft", revision: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), brief: { question: "Compare saved evidence", scope: "", sources: ["openalex"], allowanceUsd: 1, usePersonalContext: false, context: [], limits: { searchRounds: 2, papers: 6 }, model: { provider: "openai", model: "fixture", endpoint: "https://fixture.invalid", rates: { inputPerMillion: 1, outputPerMillion: 1 } } },
    approvedRevision: 1, ownerPid: null, checkpoints: {}, evidence: [], versions: [{ id: "version_1", parent: null, createdAt: new Date().toISOString(), markdown: "# Retained wording draft\n\nSaved synthetic evidence with limitations.", verification: "needs-review", author: "pipeline", sourceIds: [] }], warnings: [], completionEvent: false, error: null })
  await storage.write(`.scispark/reviews/${reviewId}/run.json`, JSON.stringify(review))
  await storage.write(`.scispark/tool-runs/${run.id}/native-review-${run.id}.json`, JSON.stringify({ reviewId, generation: 0, operationId: randomUUID(), action: { action: "revise", parent: "version_1", instruction: "Clarify wording" } }))
  await storage.write(`.scispark/tool-runs/${run.id}/steps/${stepId}.json`, JSON.stringify({ schemaVersion: 1, runId: run.id, leaseId: randomUUID(), state: "pending", intent: { id: stepId, kind: "read", replay: "reconcile", inputHash: "a".repeat(64) } }))
  let revisionPosts = 0, starts = 0
  page.on("request", req => { if (req.method() === "POST" && req.url().includes(`/api/reviews/${reviewId}`)) revisionPosts++; if (req.method() === "POST" && /\/api\/tools\/runs$/.test(req.url())) starts++ })
  await page.goto(`/tools/runs/${run.id}`)
  await expect(page.getByRole("link", { name: "Conversation", exact: true })).toHaveCount(0)
  await expect(page.getByText(/Wording revisions need a new explicit revision/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Acknowledge and retry action" })).toHaveCount(0)
  await page.getByRole("button", { name: "Open review report" }).click()
  await expect(page.getByRole("heading", { name: "Retained wording draft" })).toBeVisible()
  await page.getByRole("textbox", { name: "Revision request", exact: true }).fill("Clarify the limitations")
  await expect(page.getByRole("button", { name: "Revise wording" })).toBeDisabled()
  await page.screenshot({ path: info.outputPath("recovery-desktop.png"), fullPage: true, animations: "disabled" })
  await page.getByRole("button", { name: "Stop this run" }).click()
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Revise wording" })).toBeEnabled()
  await expect(page.getByText("Saved in History", { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" })
  await page.screenshot({ path: info.outputPath("recovery-phone.png"), fullPage: true, animations: "disabled" })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(revisionPosts).toBe(0); expect(starts).toBe(0)
})
