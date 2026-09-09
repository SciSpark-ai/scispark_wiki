import { request as httpRequest } from "node:http"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { exportVaultZip, importVaultZip } from "../src/lib/vault/export"
import { listProjects, getProject } from "../src/lib/projects/repository"
import { listSessions } from "../src/lib/chat/session"
import { loadBundle } from "../src/lib/vault/bundle"
import { listChangesetHistory } from "../src/lib/vault/history"

const PROJECT_ID = "e2e-preview-project"
const PROJECT_TITLE = "E2E Preview Project"
const PAPER_ID = "wiki/papers/e2e-grounding-paper"
const PAPER_TITLE = "E2E Grounding Paper"
const NOTE_TITLE = "E2E project note"
const QUESTION = "What does the disposable paper demonstrate?"
const ANSWER = "The disposable paper supports this project-scoped answer."

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function rawMutation(headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const port = Number(requiredEnv("SCISPARK_E2E_APP_PORT"))
  const body = JSON.stringify({ title: "blocked", description: "", instructions: "", overview: "" })
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: "/api/projects",
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...headers },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }))
    })
    request.on("error", reject)
    request.end(body)
  })
}

test.describe.serial("SP6 developer preview", () => {
  let chatPath = ""

  test("rejects unsafe mutations, forged audit writes, traversal, and settings disclosure", async ({ request }) => {
    const unsafeHost = await rawMutation({ host: "attacker.example" })
    expect(unsafeHost.status).toBe(403)
    expect(unsafeHost.body).toContain("loopback SciSpark app origin")

    const unsafeOrigin = await rawMutation({
      host: `127.0.0.1:${requiredEnv("SCISPARK_E2E_APP_PORT")}`,
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    })
    expect(unsafeOrigin.status).toBe(403)

    const forgedAudit = await request.put(
      `/api/vault/file?path=${encodeURIComponent(".scispark/changesets/forged.json")}`,
      { data: "{}", headers: { "x-vault-text": "1" } },
    )
    expect(forgedAudit.status()).toBe(403)

    const traversal = await request.get(
      `/api/vault/file?path=${encodeURIComponent("../outside.md")}`,
    )
    expect(traversal.status()).toBe(400)

    const forgedUndo = await request.post("/api/history/changes", {
      data: { changesetId: "forged", changes: [{ path: "wiki/x.md", before: null, after: "x" }] },
    })
    expect(forgedUndo.status()).toBe(400)

    const settingsResponse = await request.get("/api/settings")
    expect(settingsResponse.ok()).toBe(true)
    const settingsText = await settingsResponse.text()
    expect(settingsText).not.toContain("e2e-local-only-key")
    expect(JSON.parse(settingsText).settings.keys.openai).toEqual({ present: true })

    const settingsFile = await request.get(
      `/api/vault/file?path=${encodeURIComponent(".scispark/settings.json")}`,
    )
    expect(settingsFile.status()).toBe(403)
  })

  test("completes project, membership, note, scoped chat, deletion, History, and undo", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("scispark-notes", JSON.stringify([{ fake: true }]))
      localStorage.setItem("scispark-project-papers", JSON.stringify(["fake-paper"]))
      localStorage.setItem("scispark-paper-actions", JSON.stringify({ fake: true }))
    })

    await page.goto("/projects")
    await expect(page.getByText("Prototype browser data found")).toBeVisible()
    await page.getByRole("button", { name: "Delete prototype data" }).click()
    await expect(page.getByText("Prototype browser data found")).toBeHidden()
    await expect.poll(() => page.evaluate(() => [
      localStorage.getItem("scispark-notes"),
      localStorage.getItem("scispark-project-papers"),
      localStorage.getItem("scispark-paper-actions"),
    ])).toEqual([null, null, null])

    await page.getByRole("button", { name: "New project" }).click()
    await page.getByLabel("Title").fill(PROJECT_TITLE)
    await page.getByLabel("Description").fill("A disposable developer-preview project.")
    await page.getByLabel("AI instructions").fill("Prefer direct evidence from assigned papers.")
    await page.getByLabel("Overview").fill("This project exists only inside the temporary E2E vault.")
    await page.getByRole("button", { name: "Create project" }).click()
    await page.waitForURL(`**/projects/${PROJECT_ID}`)
    await expect(page.getByRole("heading", { name: PROJECT_TITLE })).toBeVisible()

    await page.goto("/paper/e2e-grounding-paper")
    await expect(page.getByRole("heading", { name: PAPER_TITLE })).toBeVisible()
    await page.getByRole("button", { name: PROJECT_TITLE }).click()
    await expect.poll(async () => {
      const response = await page.request.get(`/api/projects/${PROJECT_ID}`)
      if (!response.ok()) return []
      const project = await response.json()
      return project.members.map((member: { id: string }) => member.id)
    }).toContain(PAPER_ID)

    await page.goto(`/projects/${PROJECT_ID}`)
    await expect(page.getByText(PAPER_TITLE)).toBeVisible()
    await page.getByRole("button", { name: /^Notes/ }).click()
    await page.getByRole("button", { name: "New note" }).click()
    await page.getByPlaceholder("Note title").fill(NOTE_TITLE)
    await page.getByPlaceholder("Write your note…").fill("Initial note content.")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(page.getByText("Initial note content.")).toBeVisible()

    await page.getByRole("button", { name: `Edit ${NOTE_TITLE}` }).click()
    await page.getByPlaceholder("Write your note…").fill("Revised note content saved as one changeset.")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(page.getByText("Revised note content saved as one changeset.")).toBeVisible()

    await page.getByRole("button", { name: /^Chats/ }).click()
    await page.getByRole("switch", { name: /Read Sources Only/ }).check()
    await page.getByPlaceholder("Ask about your knowledge base…").fill(QUESTION)
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.locator("[data-streaming-reply]")).toContainText("The disposable paper")
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled()
    await page.waitForURL(/\/chat\/chat_[A-Za-z0-9_-]+$/)
    chatPath = new URL(page.url()).pathname
    await expect(page.getByText(ANSWER)).toBeVisible()

    await page.goto("/history?tab=conversations")
    await expect(page.getByRole("link", { name: new RegExp(QUESTION) }).last()).toBeVisible()

    await page.goto(`/projects/${PROJECT_ID}`)
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(page.getByText(/single changeset can be recovered from History/)).toBeVisible()
    await page.getByRole("button", { name: "Delete project", exact: true }).click()
    await page.waitForURL("**/projects")
    await expect(page.getByText(PROJECT_TITLE)).toBeHidden()

    await page.goto(chatPath)
    await expect(page.getByText(ANSWER)).toBeVisible()
    await expect(page.getByText(/This project's scope is unavailable\. The transcript is preserved/)).toBeVisible()

    await page.goto("/history?tab=changes")
    const deletion = page.locator("article").filter({ hasText: "project-delete" })
    await expect(deletion).toContainText("applied")
    page.once("dialog", (dialog) => void dialog.accept())
    await deletion.getByRole("button", { name: "Undo" }).click()
    await expect(deletion).toContainText("reverted")

    await expect.poll(async () => (await page.request.get(`/api/projects/${PROJECT_ID}`)).status()).toBe(200)
    await page.goto(`/projects/${PROJECT_ID}`)
    await expect(page.getByText(PAPER_TITLE)).toBeVisible()
    await page.getByRole("button", { name: /^Notes/ }).click()
    await expect(page.getByText("Revised note content saved as one changeset.")).toBeVisible()
    await page.getByRole("button", { name: /^Chats/ }).click()
    await expect(page.getByRole("link", { name: new RegExp(QUESTION) }).last()).toBeVisible()
  })

  test("surfaces stale-edit conflicts and isolates corrupt records from list pages", async ({ page }) => {
    await page.goto(`/projects/${PROJECT_ID}`)
    await page.getByRole("button", { name: "Edit", exact: true }).click()

    const detailResponse = await page.request.get(`/api/projects/${PROJECT_ID}`)
    expect(detailResponse.ok()).toBe(true)
    const detail = await detailResponse.json()
    const externalUpdate = await page.request.patch(`/api/projects/${PROJECT_ID}`, {
      data: {
        revision: detail.revision,
        title: detail.title,
        description: "Externally updated while the editor is open.",
        instructions: detail.instructions,
        overview: detail.overview,
      },
    })
    expect(externalUpdate.status()).toBe(200)

    await page.getByLabel("Description").fill("This stale browser edit must not overwrite the external update.")
    const staleResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith(`/api/projects/${PROJECT_ID}`) &&
      response.request().method() === "PATCH",
    )
    await page.getByRole("button", { name: "Save", exact: true }).click()
    expect((await staleResponsePromise).status()).toBe(409)
    await expect(page.getByText(
      "This project changed after you opened it. Reload before saving again.",
      { exact: true },
    )).toBeVisible()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()

    const storage = new NodeFsVaultStorage(requiredEnv("SCISPARK_E2E_VAULT_PATH"))
    await storage.write("wiki/projects/corrupt-project.md", "---\ntype: project\ntitle: [unterminated\n---\n")
    await storage.write(".scispark/chats/chat_corrupt.json", "{not json")
    await storage.write(".scispark/changesets/corrupt-record.json", "{not json")

    await page.goto("/projects")
    await expect(page.getByText(PROJECT_TITLE)).toBeVisible()
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)

    await page.goto("/history?tab=conversations")
    await expect(page.getByRole("link", { name: new RegExp(QUESTION) }).last()).toBeVisible()
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)

    await page.goto("/history?tab=changes")
    await expect(page.getByText("project-create")).toBeVisible()
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)
  })

  test("exports into an empty vault and restores project, chat, wiki, and History state", async () => {
    const runDir = requiredEnv("SCISPARK_E2E_RUN_DIR")
    const source = new NodeFsVaultStorage(requiredEnv("SCISPARK_E2E_VAULT_PATH"))
    const restored = new NodeFsVaultStorage(join(runDir, "restored-vault"))
    expect(await restored.list()).toEqual([])

    const archive = await exportVaultZip(source)
    const result = await importVaultZip(restored, archive)
    expect(result.files).toBeGreaterThan(0)

    const projects = await listProjects(restored)
    expect(projects.map((project) => project.id)).toContain(PROJECT_ID)
    const project = await getProject(restored, PROJECT_ID)
    expect(project.members.map((member) => member.id)).toEqual(
      expect.arrayContaining([PAPER_ID, "wiki/notes/e2e-project-note"]),
    )
    expect(project.conversations).toHaveLength(1)

    const sessions = await listSessions(restored)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].projectId).toBe(PROJECT_ID)
    expect(sessions[0].messages.some((message) => message.content === ANSWER)).toBe(true)

    const bundle = await loadBundle(restored)
    expect(bundle.pages.has(PAPER_ID)).toBe(true)
    expect(bundle.pages.has("wiki/notes/e2e-project-note")).toBe(true)
    expect((await listChangesetHistory(restored)).length).toBeGreaterThan(0)
    expect(await restored.read(".scispark/settings.json")).toBeNull()
  })
})
