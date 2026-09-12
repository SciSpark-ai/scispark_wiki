import { expect, test } from "@playwright/test"
import { DEFAULT_ENGINES } from "../src/lib/engines/contracts"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"

// Launch with SCISPARK_CODEX_PATH/SCISPARK_CLAUDE_PATH pointing at the
// deterministic engine fixtures. These exercise real child-process adapters.
for (const engine of ["codex", "claude-code"] as const) {
  test(`${engine}: connect without keys, test both models, preserve selection on reload`, async ({ page, request }, testInfo) => {
    test.skip(!process.env.SCISPARK_CODEX_PATH?.includes("fixtures/engines/") || !process.env.SCISPARK_CLAUDE_PATH?.includes("fixtures/engines/"), "Requires deterministic local engine fixtures; never use an actual subscription in E2E")
    const before = (await (await request.get("/api/settings")).json()).settings
    try {
      await request.put("/api/settings", { data: { patch: { keys: { openai: "", anthropic: "", google: "", openrouter: "" }, engines: { ...DEFAULT_ENGINES, kind: "api" } } } })
      await page.goto("/settings")
      const label = engine === "codex" ? "Codex" : "Claude Code"
      await page.getByRole("button", { name: label, exact: true }).click()
      await page.getByRole("button", { name: "Check connection", exact: true }).click()
      await expect(page.getByRole("status").filter({ hasText: "is signed in" })).toBeVisible()
      await page.getByRole("button", { name: `Use ${label}`, exact: true }).click()
      await expect(page.getByRole("status").filter({ hasText: "is now your AI engine" })).toBeVisible()
      const settings = (await (await request.get("/api/settings")).json()).settings
      expect(settings.keys).toEqual({})
      expect(settings.engines.kind).toBe(engine)
      await page.getByRole("button", { name: "Save & test models (uses plan)" }).click()
      await expect(page.getByRole("status").filter({ hasText: "Both model tiers passed" })).toBeVisible()
      const usage = await (await request.get("/api/usage")).json()
      expect(usage.summary.subscription.calls).toBeGreaterThanOrEqual(2)
      expect(usage.summary.unpricedCount).toBe(0)
      await page.reload()
      await page.goto("/settings")
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByPlaceholder("Paste your API key")).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath(`${engine}-desktop.png`), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByRole("button", { name: `Use ${label}`, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${engine}-phone.png`), fullPage: true })
      await page.getByRole("button", { name: `Use ${label}`, exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`${engine}-phone-controls.png`), fullPage: true })
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"))
      await page.screenshot({ path: testInfo.outputPath(`${engine}-phone-dark.png`), fullPage: true })
      // The real onboarding service recognizes agent readiness, without keys.
      const onboarding = await request.get("/api/onboarding")
      expect(onboarding.ok()).toBe(true)
      const state = await onboarding.json()
      expect(state.connected).toBe(true)
      await page.goto("/setup")
      await page.getByRole("button", { name: "Connect & continue" }).click()
      await expect(page).toHaveURL(/\/onboarding$/)
      const composer = page.getByRole("textbox", { name: "Your reply to Sparky" })
      await composer.fill("Ada")
      await composer.press("Enter")
      await expect(page.getByText("What research do you work on, Ada?", { exact: true })).toBeVisible()
    } finally {
      const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
      await storage.delete("profile/onboarding-conversation.json")
      await storage.write(".scispark/settings.json", JSON.stringify({ llm: { ...before, keys: { openai: "e2e-local-only-key" }, engines: DEFAULT_ENGINES } }))
    }
  })
}
