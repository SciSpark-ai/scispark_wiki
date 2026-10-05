import { test, expect, type Page } from "@playwright/test"

// A separate browser session must not revoke the shared acceptance fixture's login.
test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} })

async function profileRequest(page: Page, path: string, method = "GET", data?: unknown) {
  return page.evaluate(async ({ path, method, data }) => {
    const response = await fetch(path, { method, ...(data === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(data) }) })
    return { status: response.status, body: await response.json() }
  }, { path, method, data })
}

async function createProfile(page: Page, name: string) {
  await page.getByLabel("Create a new profile", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Create profile", exact: true }).click()
  await page.waitForURL("**/setup")
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible()
  // Supply a deterministic research profile without invoking a paid onboarding model.
  expect((await profileRequest(page, "/api/profile", "POST", { name, role: "Researcher", fields: "Neuroscience", topics: "Hearing", feedPrefs: "Methods" })).status).toBe(201)
  await page.goto("/projects")
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible()
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click()
  await page.getByRole("button", { name: "Log out", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Choose your profile" })).toBeVisible()
}

test("local profiles keep vaults isolated through creation, logout, switching, reload and mobile", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Choose your profile" })).toBeVisible()
  expect((await context.request.get("/api/vault/list")).status()).toBe(401)

  await createProfile(page, "Ada isolated")
  const ada = (await profileRequest(page, "/api/local-profiles/session")).body.profile
  await page.getByRole("button", { name: "New project" }).click()
  await page.getByLabel("Title", { exact: true }).fill("Ada research")
  await page.getByRole("button", { name: "Create project", exact: true }).click()
  await page.waitForURL("**/projects/ada-research")
  await page.getByRole("button", { name: /^Notes/ }).click()
  await page.getByRole("button", { name: "New note" }).click()
  await page.getByPlaceholder("Note title").fill("Ada private note")
  await page.getByPlaceholder("Write your note…").fill("Saved in Ada's vault only.")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText("Saved in Ada's vault only.")).toBeVisible()
  await page.getByRole("button", { name: "Profile menu" }).click()
  await page.screenshot({ path: testInfo.outputPath("profile-logout-desktop.png"), fullPage: true })
  await page.getByRole("button", { name: "Log out", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Choose your profile" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Choose your profile" })).toBeVisible()
  expect((await context.request.get("/api/projects/ada-research")).status()).toBe(401)

  await createProfile(page, "Grace isolated")
  const grace = (await profileRequest(page, "/api/local-profiles/session")).body.profile
  expect(grace.vaultPath).not.toBe(ada.vaultPath)
  expect((await profileRequest(page, "/api/projects/ada-research")).status).toBe(404)
  expect((await profileRequest(page, "/api/vault/list?prefix=wiki/notes/")).body.paths).toEqual([])
  const stale = await context.request.put("/api/vault/file?path=wiki/notes/wrong-profile.md", { headers: { "x-scispark-profile": ada.id, "x-vault-text": "1" }, data: "must not cross vaults" })
  expect(stale.status()).toBe(409)
  const staleLogout = await context.request.delete("/api/local-profiles/session", { headers: { "x-scispark-profile": ada.id } })
  expect(staleLogout.status()).toBe(409)
  expect((await profileRequest(page, "/api/local-profiles/session")).body.profile.id).toBe(grace.id)
  expect((await profileRequest(page, "/api/vault/list?prefix=wiki/notes/")).body.paths).toEqual([])

  // Another open tab follows logout and never keeps the previous research mounted.
  const other = await context.newPage()
  await other.goto("/projects")
  await expect(other.getByRole("button", { name: "Profile menu" })).toBeVisible()
  await logout(page)
  await expect(other.getByRole("heading", { name: "Choose your profile" })).toBeVisible()
  await other.close()
  await page.getByRole("button", { name: /Ada isolated.*Open vault/ }).click()
  await expect(page.getByRole("button", { name: "Profile menu" })).toBeVisible()
  await page.goto("/projects/ada-research")
  await page.getByRole("button", { name: /^Notes/ }).click()
  await expect(page.getByText("Saved in Ada's vault only.")).toBeVisible()
  await page.reload()
  expect((await profileRequest(page, "/api/local-profiles/session")).body.profile.id).toBe(ada.id)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Open menu" }).click()
  await logout(page)
  await page.screenshot({ path: testInfo.outputPath("profile-chooser-mobile.png"), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: testInfo.outputPath("profile-chooser-desktop.png"), fullPage: true })
})
