import { expect, test, type Page } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"

test("Sparky only shows new events, once across reloads and tabs, and clears stale bubbles", async ({ page, request, context }, testInfo) => {
  const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH
  if (!vaultPath || !process.env.SCISPARK_E2E_RUN_DIR || !vaultPath.startsWith(process.env.SCISPARK_E2E_RUN_DIR + "/")) {
    throw new Error("This test requires the runner's disposable vault")
  }
  const storage = new NodeFsVaultStorage(vaultPath)
  const ledgerPath = ".scispark/companion-delivery.json"
  const reviewPath = ".scispark/review/e2e-proactive-duplicate.json"
  const originalLedger = await storage.read(ledgerPath)
  const originalCompanion = (await (await request.get("/api/settings")).json()).companion
  const bubble = page.locator("[data-companion-bubble]")
  const navigate = async (target: Page, route: string) => {
    const check = target.waitForResponse((r) => r.url().endsWith("/api/skills/companion"))
    await target.goto(route)
    await (await check).finished()
  }
  const resetEvent = async () => {
    // Only test-owned operational state in the runner's temporary vault.
    await storage.write(ledgerPath, JSON.stringify({ version: 1, records: [] }))
    await storage.write(reviewPath, JSON.stringify({
      id: "e2e-proactive-duplicate", createdAt: new Date().toISOString(), kind: "duplicate",
      title: "Possible duplicate: E2E Grounding Paper", description: "A disposable review fixture.",
      pages: ["e2e-grounding-paper"],
    }))
  }
  try {
    expect((await request.put("/api/settings", { data: { companion: { chattiness: "medium", companionName: "Sparky" } } })).ok()).toBe(true)
    await navigate(page, "/")
    await expect(bubble).toHaveCount(0) // No app-open or generic Home nudge.

    await resetEvent()
    await page.setViewportSize({ width: 1440, height: 900 })
    await navigate(page, "/wiki")
    await expect(bubble).toContainText("A possible duplicate needs your review.")
    await expect(bubble.getByRole("link", { name: "Review inbox" })).toHaveAttribute("href", "/wiki/inbox")
    await expect(bubble.getByRole("link", { name: "Home", exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("companion-desktop.png") })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(bubble).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("companion-phone.png") })
    await bubble.getByRole("button", { name: "Dismiss", exact: true }).click()
    await expect(bubble).toHaveCount(0)

    await navigate(page, "/wiki") // Full navigation resets all Zustand state.
    await expect(bubble).toHaveCount(0)
    const other = await context.newPage()
    await navigate(other, "/wiki")
    await expect(other.locator("[data-companion-bubble]")).toHaveCount(0)
    await other.close()
    expect(JSON.parse((await storage.read(ledgerPath))!).records).toHaveLength(1)

    // Simultaneous real API requests share one persisted claim, before the
    // local provider streams a reply. No paid/external model is configured.
    await page.goto("/chat")
    await resetEvent()
    const replies = await Promise.all([1, 2].map(async () => {
      const response = await request.post("/api/skills/companion", { data: { route: "/wiki" } })
      expect(response.ok()).toBe(true)
      return (await response.json()).result
    }))
    expect(replies.filter(Boolean)).toHaveLength(1)
    expect(JSON.parse((await storage.read(ledgerPath))!).records).toHaveLength(1)

    await resetEvent()
    await navigate(page, "/wiki/inbox")
    await expect(bubble).toHaveCount(0)
    await navigate(page, "/wiki")
    await expect(bubble).toHaveCount(0) // Don't recommend somewhere just visited.
    expect(JSON.parse((await storage.read(ledgerPath))!).records[0].viewed).toBe(true)

    await page.goto("/chat")
    await resetEvent()
    await page.clock.install()
    await navigate(page, "/wiki")
    await expect(bubble.getByRole("link", { name: "Review inbox" })).toBeVisible()
    await page.clock.fastForward(61_000)
    await expect(bubble).toHaveCount(0)
  } finally {
    await page.goto("/chat") // Stop any proactive checks before restoring fixtures.
    await storage.delete(reviewPath)
    if (originalLedger === null) await storage.delete(ledgerPath)
    else await storage.write(ledgerPath, originalLedger)
    expect((await request.put("/api/settings", { data: { companion: originalCompanion } })).ok()).toBe(true)
  }
})
