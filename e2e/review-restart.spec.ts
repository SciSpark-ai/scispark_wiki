import { expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { spawn, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import { once } from "node:events"
import { createRequire } from "node:module"
import { z } from "zod"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { openVault } from "../src/lib/vault/scaffold"
import { saveSettings } from "../src/lib/llm/settings"
import { loadReview, reviewCheckpoint } from "../src/lib/review/store"
import { ReviewEvidenceSchema } from "../src/lib/review/contracts"
import { hashReviewData } from "../src/lib/review/budget"
import { PaperSnapshotSchema } from "../src/lib/chat/blocks"

const { reviewResponse } = createRequire(join(process.cwd(), "e2e/review-restart.spec.ts"))("./fixtures/review-responses.mjs")
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
test("production restart retains checkpoints and requires explicit acknowledgement before uncertain replay", async ({ page }) => {
  test.skip(process.env.SCISPARK_E2E_SERVER_MODE !== "start", "Requires the isolated production artifact")
  test.setTimeout(120_000)
  const runDir = process.env.SCISPARK_E2E_RUN_DIR!
  if (!runDir.includes("scispark-e2e-")) throw new Error("Disposable test directory required")
  const storage = new NodeFsVaultStorage(join(runDir, "restart-vault"))
  let requests = 0, planned = 0, holdThird = true
  const llm = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk
    const data = JSON.parse(body)
    requests++
    if (data.messages[0].content.startsWith("Plan a bounded")) planned++
    if (holdThird && requests === 3) { req.socket.on("close", () => res.destroy()); return }
    const output = reviewResponse(data.messages)
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }], model: data.model, usage: { prompt_tokens: 100, completion_tokens: 80 } }))
  })
  llm.listen(0, "127.0.0.1"); await once(llm, "listening")
  const llmPort = (llm.address() as { port: number }).port
  const portProbe = createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening")
  const port = (portProbe.address() as { port: number }).port
  await new Promise<void>((resolve) => portProbe.close(() => resolve()))
  const base = `http://127.0.0.1:${port}`
  let child: ChildProcess | undefined
  let logs = ""
  const stop = async () => { if (child?.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited }; child = undefined }
  const start = async () => {
    child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: { ...process.env, SCISPARK_VAULT: join(runDir, "restart-vault"), SCISPARK_LIVE_GATE_DIST_DIR: process.env.SCISPARK_E2E_DIST_DIR, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout?.on("data", (b) => { logs = (logs + b).slice(-6000) }); child.stderr?.on("data", (b) => { logs = (logs + b).slice(-6000) })
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Disposable server exited: ${logs}`)
      try { if ((await fetch(`${base}/api/vault/list`)).ok) return } catch {}
      await wait(100)
    }
    throw new Error(`Disposable server did not start: ${logs}`)
  }
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) })
  try {
    await openVault(storage)
    await saveSettings(storage, { keys: { openai: "fixture-key-no-paid-service" }, dailyBudgetUsd: 100,
      baseUrls: { openai: `http://127.0.0.1:${llmPort}/v1` }, tierModels: { fast: { provider: "openai", model: "gpt-5.4-mini" }, strong: { provider: "openai", model: "gpt-5.4-mini" } } })
    await start()
    const created = await post("/api/reviews", { sessionId: "restart-chat", operationId: "restart", question: "Compare adult decoding methods", sources: ["openalex"] })
    expect(created.ok).toBe(true)
    const { run } = await created.json()
    const amended = await post(`/api/reviews/${run.id}`, { action: "amend", revision: run.revision, question: run.brief.question, scope: run.brief.scope,
      allowanceUsd: 2, usePersonalContext: false, rates: { inputPerMillion: 0.75, outputPerMillion: 3.75 } })
    expect(amended.ok).toBe(true)
    const paper = { ids: { doi: "10.1000/restart" }, title: "Adult decoding restart fixture", abstract: "Among 30 adults, decoding improved with the tested method. Pediatric outcomes were not studied.", authors: [], fields: [], source: "openalex" as const }
    const schema = z.object({ papers: z.array(PaperSnapshotSchema), warnings: z.array(z.string()) })
    await reviewCheckpoint(storage, run.id, "initial-search-v1", [{ source: "openalex", query: "adult decoding" }], schema, async () => ({ papers: [paper], warnings: [] }))
    await reviewCheckpoint(storage, run.id, "gap-search-v1", [{ source: "openalex", query: "null adult decoding", gap: "Conflicting findings" }], schema, async () => ({ papers: [], warnings: [] }))
    await reviewCheckpoint(storage, run.id, "acquire-v2", { paper, id: "P1" }, ReviewEvidenceSchema.nullable(), async () => ({ id: "P1", paper, title: paper.title, text: paper.abstract, access: "abstract" as const, locator: "Fixture abstract", hash: hashReviewData(paper.abstract), retrievedAt: new Date().toISOString(), notes: [] }))
    expect((await post(`/api/reviews/${run.id}`, { action: "approve", revision: (await loadReview(storage, run.id)).revision })).ok).toBe(true)
    await expect.poll(() => requests).toBe(3)
    const checkpointCount = Object.keys((await loadReview(storage, run.id)).checkpoints).length
    await stop(); holdThird = false; await start()
    const snapshot = await (await fetch(`${base}/api/reviews/${run.id}`)).json()
    expect(snapshot.run.status).toBe("interrupted")
    expect(snapshot.spending.uncertain).toBe(true)
    expect(Object.keys(snapshot.run.checkpoints)).toHaveLength(checkpointCount)
    await page.goto(`${base}/chat/restart-chat`)
    await expect(page.getByText("The local server stopped", { exact: false })).toBeVisible()
    expect(requests).toBe(3) // Reopening never schedules a new paid attempt.
    expect((await post(`/api/reviews/${run.id}`, { action: "resume", revision: snapshot.run.revision })).ok).toBe(false)
    expect((await post(`/api/reviews/${run.id}`, { action: "resume", revision: snapshot.run.revision, acknowledgeUncertainCharge: true })).ok).toBe(true)
    await expect.poll(async () => (await loadReview(storage, run.id)).status, { timeout: 40_000 }).toBe("completed")
    expect(planned).toBe(1) // The settled planning call is reused from disk.
    expect((await loadReview(storage, run.id)).approvals).toHaveLength(2)
  } finally { await stop(); llm.closeAllConnections(); await new Promise<void>((resolve) => llm.close(() => resolve())) }
})
