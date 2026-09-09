import { expect, test } from "@playwright/test"

test("avatar camera supports keyboard upload, validation, cancel, save and removal", async ({ page, request }, testInfo) => {
  if (!process.env.SCISPARK_E2E_VAULT_PATH) throw new Error("Disposable vault required")
  const beforeTheme = (await (await request.get("/api/settings")).json()).ui.theme
  const changes: string[] = []
  const errors: string[] = []
  let writes = 0
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (req) => { if (req.url().endsWith("/api/profile") && req.method() === "PATCH") writes++ })
  try {
    const created = await request.post("/api/profile", { data: {
      name: "Avatar Tester", role: "Researcher", fields: "Neuroscience", topics: "Hearing", feedPrefs: "",
    } })
    expect(created.status()).toBe(201)
    changes.push((await created.json()).changesetId)
    await page.goto("/profile")
    const avatar = page.getByTestId("profile-avatar")
    const camera = page.getByRole("button", { name: "Change profile photo", exact: true })
    const input = page.locator('input[type="file"]')
    const profileImage = avatar.getByRole("img", { name: "Avatar Tester profile", exact: true })
    const cancel = page.getByRole("button", { name: "Cancel", exact: true })
    const save = page.getByRole("button", { name: "Save changes", exact: true })
    await expect(camera).toBeVisible()
    await expect(page.getByRole("button", { name: "Add photo", exact: true })).toHaveCount(0)

    // A real browser-made PNG fixture, never a human photo or external request.
    const photo = await page.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 64; canvas.height = 64
      const context = canvas.getContext("2d")!
      context.fillStyle = "steelblue"; context.fillRect(0, 0, 64, 64)
      context.fillStyle = "white"; context.font = "32px sans-serif"
      context.textAlign = "center"; context.textBaseline = "middle"; context.fillText("A", 32, 34)
      return canvas.toDataURL("image/png")
    })
    const file = { name: "avatar.png", mimeType: "image/png", buffer: Buffer.from(photo.split(",")[1], "base64") }
    async function choosePhoto() {
      await camera.focus()
      const chooser = page.waitForEvent("filechooser")
      await camera.press("Enter")
      await (await chooser).setFiles(file)
      await expect(profileImage).toBeVisible()
      await expect(profileImage).toHaveJSProperty("naturalWidth", 64)
    }

    for (const state of ["initials", "photo"]) {
      if (state === "photo") {
        // Validation rejects bad files without writing or losing the draft.
        const chooser = page.waitForEvent("filechooser")
        await camera.click()
        await (await chooser).setFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") })
        await expect(page.getByRole("main").getByRole("alert")).toContainText("Choose a PNG, JPEG, or WebP image.")
        await input.setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(1_000_001) })
        await expect(page.getByRole("main").getByRole("alert")).toContainText("smaller than 1 MB")
        await input.setInputFiles(file)
        await expect(profileImage).toBeVisible()
        expect(writes).toBe(0)
        await cancel.click()
        await expect(profileImage).toHaveCount(0)
        expect((await (await request.get("/api/profile")).json()).profile.avatarDataUrl).toBeNull()
        await choosePhoto()
        const response = page.waitForResponse((res) => res.url().endsWith("/api/profile") && res.request().method() === "PATCH")
        await save.click()
        const saved = await response
        expect(saved.status()).toBe(200)
        changes.push((await saved.json()).changesetId)
        await expect(page.getByRole("main").getByRole("status")).toContainText("Profile saved.")
      }
      for (const viewport of [
        { name: "desktop", width: 1440, height: 900, theme: "light" },
        { name: "phone", width: 390, height: 844, theme: "dark" },
      ]) {
        await request.put("/api/settings", { data: { ui: { theme: viewport.theme } } })
        await page.setViewportSize(viewport)
        await page.goto("/profile")
        await expect(camera).toBeVisible()
        if (state === "photo") await expect(profileImage).toHaveJSProperty("naturalWidth", 64)
        const circle = (await avatar.boundingBox())!
        const button = (await camera.boundingBox())!
        expect(button.width).toBe(32)
        expect(button.height).toBe(32)
        expect(button.x).toBeCloseTo(circle.x + circle.width - button.width)
        expect(button.y).toBeCloseTo(circle.y + circle.height - button.height)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath("avatar-" + state + "-" + viewport.name + ".png") })
      }
    }
    expect(writes).toBe(1)
    expect((await (await request.get("/api/profile")).json()).profile.avatarDataUrl).toBe(photo)
    await page.getByRole("button", { name: "Edit profile", exact: true }).click()
    await page.getByRole("button", { name: "Remove photo", exact: true }).click()
    await expect(profileImage).toHaveCount(0)
    const response = page.waitForResponse((res) => res.url().endsWith("/api/profile") && res.request().method() === "PATCH")
    await save.click()
    const removed = await response
    expect(removed.status()).toBe(200)
    changes.push((await removed.json()).changesetId)
    await page.reload()
    await expect(camera).toBeVisible()
    await expect(profileImage).toHaveCount(0)
    expect((await (await request.get("/api/profile")).json()).profile.avatarDataUrl).toBeNull()
    expect(errors).toEqual([])
  } finally {
    await request.put("/api/settings", { data: { ui: { theme: beforeTheme } } })
    for (const changesetId of changes.reverse()) {
      expect((await request.post("/api/history/changes", { data: { changesetId } })).ok()).toBe(true)
    }
  }
})
