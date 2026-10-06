import { test, expect } from "@playwright/test"

test("literature-review catalog uses explicit prerequisite/import, root-only selection and honest setup", async ({ page, request }, info) => {
  let runs = 0
  page.on("request", req => { if (req.method() === "POST" && /\/api\/tools\/runs$/.test(req.url())) runs++ })
  await page.goto("/tools")
  await page.getByRole("button", { name: "Add tools", exact: true }).click()
  await page.getByRole("button", { name: "Literature review", exact: true }).click()
  await page.getByRole("button", { name: "Preview literature review" }).click()
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("pinned OpenCite")
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport)
    const output = info.outputPath(`prerequisite-${name}.png`)
    await page.screenshot({ path: output, fullPage: true, animations: "disabled" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole("button", { name: "Review OpenCite", exact: true }).click()
  await page.getByRole("button", { name: "Preview OpenCite" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("I reviewed these tools, their access and setup requirements.").check()
  await dialog.getByRole("button", { name: "Confirm import" }).click()
  await expect(dialog.getByRole("status").filter({ hasText: "Import saved." })).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: "Add tools", exact: true }).click()
  await page.getByRole("button", { name: "Literature review", exact: true }).click()
  await page.getByRole("button", { name: "Preview literature review" }).click()
  await expect(dialog.locator("article")).toHaveCount(5)
  await expect(dialog.locator("article input:checked")).toHaveCount(1)
  await expect(dialog.locator("article input:disabled")).toHaveCount(4)
  await dialog.getByLabel("I reviewed these tools, their access and setup requirements.").check()
  await dialog.getByRole("button", { name: "Confirm import" }).click()
  await expect(dialog.getByRole("status").filter({ hasText: "Import saved." })).toBeVisible()
  const root = dialog.locator("article").filter({ has: page.getByText("Literature review", { exact: true }) })
  await expect(root.getByRole("button", { name: "Manage setup" })).toBeVisible()
  await expect(root.getByRole("button", { name: "Manage setup" })).toBeEnabled()
  await expect(root).toContainText("Supporting tool: OpenCite")
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport); await root.scrollIntoViewIfNeeded()
    const output = info.outputPath(`import-${name}.png`)
    await page.screenshot({ path: output, fullPage: true, animations: "disabled" })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  const library = (await (await request.get("/api/tools?view=library")).json()).result
  expect(library.tools.filter((t: { ref: { packageId: string }; enabled: boolean }) => t.ref.packageId === "neuromechanist.literature-review" && t.enabled)).toHaveLength(1)
  expect(runs).toBe(0)
})
