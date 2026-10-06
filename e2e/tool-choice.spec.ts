import { expect, test } from "@playwright/test"
import { importTool, resetTools, providerRows, snapshot } from "./fixtures/modular"

test("ambiguous Sparky choice performs one classification and creates one chosen root", async ({ page, request }, info) => {
  await resetTools()
  await importTool(request, "Evidence comparison A")
  const { ref } = await importTool(request, "Evidence comparison B")
  await request.post("/api/profile", { data: { name: "Ada", role: "Researcher", fields: "Neuroscience", topics: "Speech", feedPrefs: "Methods" } })
  const before = (await (await request.get("/api/tools/runs")).json()).result.length
  await page.goto("/chat?new=1")
  await page.getByRole("textbox", { name: "Message Sparky" }).fill("MODULAR:choice Compare the supplied research evidence")
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByRole("button", { name: /^Evidence comparison B/ })).toBeVisible()
  expect((await (await request.get("/api/tools/runs")).json()).result).toHaveLength(before)
  await page.waitForURL(/\/chat\/chat_/); await expect(page.getByRole("button", { name: /^Evidence comparison B/ })).toBeVisible()
  await page.screenshot({ path: info.outputPath("ambiguousSparky.png"), fullPage: true })
  await page.reload()
  await page.getByRole("button", { name: /^Evidence comparison B/ }).click()
  await expect.poll(async () => (await (await request.get("/api/tools/runs")).json()).result.length).toBe(before + 1)
  const runs = (await (await request.get("/api/tools/runs")).json()).result
  const run = runs.at(-1)
  expect(run.tool).toEqual(ref)
  await expect.poll(async () => (await snapshot(request, run.id)).status, { timeout: 25000 }).toBe("completed")
  await page.reload()
  expect((await providerRows("choice")).filter(r => r.phase === "classification")).toHaveLength(1)
  expect((await providerRows("choice")).filter(r => r.phase === "review-synthesis")).toHaveLength(1)
  expect((await (await request.get("/api/tools/runs")).json()).result).toHaveLength(before + 1)
})
