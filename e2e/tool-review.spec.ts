import { expect, test } from "@playwright/test"
import { importTool, resetTools, startTool, snapshot, readRunFile, providerRows, vaultDir } from "./fixtures/modular"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"

test("executed source-linked review has cumulative usage and explicit reversible wiki save", async ({ page, request }, info) => {
  await resetTools()
  const { ref } = await importTool(request, "Review acceptance")
  const run = await startTool(request, ref, "MODULAR:review")
  await expect.poll(async () => (await snapshot(request, run.id)).status, { timeout: 25000 }).toBe("completed")
  const storage = new NodeFsVaultStorage(vaultDir()), paths = await storage.list("wiki/notes/")
  expect(paths).toEqual([])
  await page.goto(`/tools/runs/${run.id}`)
  await expect(page.getByText("Completed", { exact: true })).toBeVisible()
  await page.getByText("Sources (1)", { exact: true }).click()
  await expect(page.getByRole("link", { name: "https://doi.org/10.1000/modular-fixture", exact: true }).first()).toHaveAttribute("href", "https://doi.org/10.1000/modular-fixture")
  await expect(page.getByText(/no clinical validation/).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath("completed-source-linked-results.png"), fullPage: true })
  await page.getByRole("button", { name: "Add to wiki", exact: true }).click()
  await expect(page.getByRole("link", { name: "Review or undo in History" })).toBeVisible()
  const savedPaths = (await storage.list("wiki/notes/")).filter(path => path.endsWith(".md"))
  expect(savedPaths).toHaveLength(1)
  expect(await storage.read(savedPaths[0])).toContain("10.1000/modular-fixture")
  await page.getByRole("link", { name: "Review or undo in History" }).click()
  page.once("dialog", dialog => dialog.accept())
  const change = page.locator("article").filter({ hasText: "workflow:" }).first()
  await change.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(change).toContainText("Already undone.")
  expect(await storage.read(savedPaths[0])).toBeNull()
  const usage = await readRunFile(run.id, "usage.json")
  expect(usage.attempts).toHaveLength(3)
  expect((await providerRows("review")).filter(row => row.phase === "review-synthesis")).toHaveLength(1)
  expect((await snapshot(request, run.id)).usage.modelCalls).toBe(3)
})

test("missing provider stays in setup without dispatch or live fallback", async ({ page, request }) => {
  const storage = new NodeFsVaultStorage(vaultDir())
  const settings = (await storage.read(".scispark/settings.json"))!
  await resetTools()
  const { ref } = await importTool(request, "Unavailable provider")
  await storage.write(".scispark/settings.json", JSON.stringify({ ...JSON.parse(settings), llm: { ...JSON.parse(settings).llm, keys: {} } }))
  try {
    const run = await startTool(request, ref, "MODULAR:unavailable")
    await expect.poll(async () => (await snapshot(request, run.id)).status).toBe("waiting_for_setup")
    await page.goto(`/tools/runs/${run.id}`)
    await expect(page.getByText("Setup needed", { exact: true })).toBeVisible()
    expect(await providerRows("unavailable")).toEqual([])
    expect((await snapshot(request, run.id)).usage.modelCalls).toBe(0)
    // Explicit cancellation releases this profile's FIFO; reading never resumes.
    const { randomUUID } = await import("node:crypto")
    const stopped = await request.post(`/api/tools/runs/${run.id}/actions`, { data: { action: "cancel", operationId: randomUUID() } })
    expect(stopped.ok()).toBe(true)
  } finally { await storage.write(".scispark/settings.json", settings) }
})
