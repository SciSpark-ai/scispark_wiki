import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { FEED_CACHE_PATH } from "../src/lib/skills/feed-cache"
import { DEFAULT_ENGINES } from "../src/lib/engines/contracts"
import { LEDGER_PATH, readLedger } from "../src/lib/runs/ledger"

test("server feed survives navigation and preserves a later failed replacement across reload", async ({ page, request }, info) => {
  test.setTimeout(100_000)
  test.skip(process.env.SCISPARK_E2E_FEED_FIXTURE !== "1" || !process.env.SCISPARK_CODEX_PATH?.includes("fixtures/engines/"), "Disposable source and CLI fixtures required")
  const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH!
  if (!vaultPath.includes("scispark-e2e-")) throw new Error("Disposable vault required")
  const storage = new NodeFsVaultStorage(vaultPath)
  const paths = [FEED_CACHE_PATH, LEDGER_PATH, ".scispark/settings.json", "profile.md", "interests.md", "feedback.md"]
  const before = await Promise.all(paths.map(async path => [path, await storage.read(path)] as const))
  let posts = 0
  const refreshAlert = page.getByRole("alert").filter({ hasText: "Feed refresh needs attention" })
  page.on("request", req => { if (new URL(req.url()).pathname === "/api/skills/feed/refresh" && req.method() === "POST") posts++ })
  try {
    expect((await request.post("/api/profile", { data: { name: "Ada", role: "Researcher", fields: "Neuroscience", topics: "Sparse attention SCISPARK_FEED_FIXTURE", feedPrefs: "Research findings" } })).ok()).toBe(true)
    expect((await request.put("/api/settings", { data: { patch: { engines: { ...DEFAULT_ENGINES, kind: "codex" } } } })).ok()).toBe(true)
    await page.goto("/")
    await page.getByRole("button", { name: "Refresh feed", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Formulating strategy" })).toBeVisible()
    await page.goto("/wiki")
    await page.goto("/")
    await expect(page.getByRole("button", { name: "Refreshing…", exact: true })).toBeDisabled()
    await page.reload()
    await expect(page.getByRole("status").filter({ hasText: "Formulating strategy" })).toBeVisible()
    expect(posts).toBe(1)
    await page.screenshot({ path: info.outputPath("feed-server-running-after-reload.png"), fullPage: true })
    await expect(page.getByRole("heading", { name: "Background feed fixture paper 1", exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("2 papers shown · 2 recent · 0 older", { exact: true })).toBeVisible()
    const successful = await storage.read(FEED_CACHE_PATH)
    expect((await readLedger(storage))[0]).toMatchObject({ status: "ok", meta: { cacheUpdated: true, itemCount: 2 } })
    await page.screenshot({ path: info.outputPath("feed-server-completed.png"), fullPage: true })

    await storage.write("profile.md", (await storage.read("profile.md"))! + "\nFIXTURE_FEED_FAIL\n")
    await page.getByRole("button", { name: "Refresh feed", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "Formulating strategy" })).toBeVisible()
    await page.goto("/wiki")
    await page.goto("/")
    await expect(page.getByRole("button", { name: "Refreshing…", exact: true })).toBeDisabled()
    await expect(refreshAlert).toContainText("AI relevance assessment did not complete", { timeout: 30_000 })
    expect(await storage.read(FEED_CACHE_PATH)).toBe(successful)
    expect((await readLedger(storage))[0]).toMatchObject({ status: "degraded", meta: { cacheUpdated: false } })
    const attempts = await storage.read(LEDGER_PATH)
    await page.reload()
    await expect(refreshAlert).toContainText("Your previous feed is still shown")
    await expect(page.getByRole("heading", { name: "Background feed fixture paper 1", exact: true })).toBeVisible()
    await page.goto("/wiki")
    await page.goto("/")
    await expect(refreshAlert).toContainText("AI relevance assessment did not complete")
    expect(posts).toBe(2)
    expect(await storage.read(LEDGER_PATH)).toBe(attempts)
    await page.screenshot({ path: info.outputPath("feed-server-failure-preserved.png"), fullPage: true })
  } finally {
    for (const [path, content] of before) {
      if (content === null) await storage.delete(path)
      else await storage.write(path, content)
    }
  }
})
