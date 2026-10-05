import { test, expect } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { FEED_CACHE_PATH } from "../src/lib/skills/feed-cache"
import { seedUserModel, USER_MODEL_PATHS } from "../src/lib/usermodel/pages"
import { paperSlug } from "../src/lib/wiki/authoring"
import { paperKey, type PaperRecord } from "../src/lib/papers/types"
import { readLedger } from "../src/lib/runs/ledger"

const digest = { summary: "BACKGROUND-FIXTURE: Attention decoding.", laySummary: "Tracks attention.", keyPoints: ["Adaptive smoothing"], methods: "Uses past signals.", limitations: "Controlled experiment.", fieldContext: "EEG decoding." }

let originals: { path: string; content: string | null }[] = []
test.beforeEach(async () => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  originals = await Promise.all([FEED_CACHE_PATH, ...Object.values(USER_MODEL_PATHS)].map(async path => ({ path, content: await storage.read(path) })))
})
test.afterEach(async () => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  for (const { path, content } of originals) { if (content === null) await storage.delete(path); else await storage.write(path, content) }
})

async function seed(title: string) {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const paper: PaperRecord = { ids: {}, title, authors: [{ name: "Background Researcher" }], abstract: "BACKGROUND-FIXTURE: Attention decoding using past signals.", source: "s2", fields: [], year: 2026 }
  await seedUserModel(storage, { name: "Alex", role: "Researcher", fields: "Neuroscience", topics: "Attention", feedPrefs: "Methods and evidence" })
  await storage.write(FEED_CACHE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), costUsd: 0, strategy: { queries: [{ source: "arxiv", query: "attention", rationale: "fixture" }] }, stats: { retrieved: 1, ranked: 1 }, items: [{ paper, score: 1, whyThis: "Attention", whyYou: "Research", whyNow: "Recent" }] }))
  return { storage, paper, slug: paperSlug(paper) }
}

test("ingestion survives navigation and reload, completes once and restores Undo", async ({ page }, info) => {
  const { storage, paper, slug } = await seed("Background ingestion fixture")
  await storage.write(`.scispark/digests/${slug}.json`, JSON.stringify(digest))
  const posts: string[] = []
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/skills/ingest")) posts.push(request.url()) })
  await page.goto(`/paper/${slug}`)
  await page.getByRole("button", { name: "Add to knowledge base", exact: true }).click()
  await expect(page.getByText("Ingesting into wiki…", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Wiki", exact: true }).click()
  await expect(page).toHaveURL(/\/wiki$/)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/paper/${slug}$`))
  await expect(page.getByText("Ingesting into wiki…", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add to knowledge base", exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByText("Ingesting into wiki…", { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("ingest-reconnected.png"), fullPage: true })
  await expect(page.getByText("Added to knowledge base", { exact: true })).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText("In your knowledge base", { exact: true })).toBeVisible()
  expect(posts).toHaveLength(1)
  const ledger = await readLedger(storage)
  expect(ledger.filter(entry => entry.orchestrator === "ingest")).toHaveLength(1)
  expect(await storage.read(`wiki/papers/${slug}.md`)).toContain(paper.title)
  await page.reload()
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("ingest-completed.png"), fullPage: true })
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(page.getByRole("button", { name: "Undone", exact: true })).toBeDisabled()
  expect(await storage.read(`wiki/papers/${slug}.md`)).toBeNull()
  await page.reload()
  await expect(page.getByRole("button", { name: "Add to knowledge base", exact: true })).toBeEnabled()
  await expect(page.getByText("Added to knowledge base", { exact: true })).toHaveCount(0)
})

test("digest generation reconnects after reload without another provider request", async ({ page }, info) => {
  const { storage, paper, slug } = await seed("Background digest fixture")
  const stem = paperKey(paper).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
  await storage.write(`sources/${stem}.html`, `<article><h1>${paper.title}</h1><h2>Methods</h2><p>BACKGROUND-FIXTURE: ${"The detector uses causal attention over historical signals. ".repeat(30)}</p><h2>Results</h2><p>Stable attention decoding.</p></article>`)
  let posts = 0
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/skills/digest")) posts++ })
  await page.goto(`/paper/${slug}`)
  await page.getByRole("button", { name: "Generate digest", exact: true }).click()
  await expect(page.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled()
  await page.getByRole("link", { name: "Wiki", exact: true }).click()
  await expect(page).toHaveURL(/\/wiki$/)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/paper/${slug}$`))
  await expect(page.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Digest generated", exact: true })).toBeDisabled({ timeout: 20_000 })
  await expect(page.locator("#digest-methods")).toContainText("historical key-value cache")
  expect(posts).toBe(1)
  await page.screenshot({ path: info.outputPath("digest-reconnected.png"), fullPage: true })
})

test("a pending chat remains busy after returning and reload, then displays its saved answer", async ({ page }) => {
  await seed("Background chat fixture")
  await page.goto("/chat?new=1")
  let sessionId = ""
  let posts = 0
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith("/api/skills/chat")) {
      posts++; sessionId = request.postDataJSON().sessionId
    }
  })
  await page.getByRole("textbox", { name: "Message Sparky" }).fill("BACKGROUND-FIXTURE: What does the grounding paper say?")
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect.poll(() => sessionId).not.toBe("")
  await expect.poll(async () => (await page.request.get(`/api/skills/jobs?key=chat:${sessionId}`)).json().then(body => body.result?.status)).toBe("running")
  await page.getByRole("link", { name: "Wiki", exact: true }).click()
  await expect(page).toHaveURL(/\/wiki$/)
  await page.getByRole("link", { name: "Sparky", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}`))
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
  await expect(page.getByText("The disposable paper supports this project-scoped answer.", { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(posts).toBe(1)
})
