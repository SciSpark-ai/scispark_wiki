import { expect, test } from "@playwright/test"
import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { buildPaperPage, paperSlug } from "../src/lib/wiki/authoring"
import { serializeDocument } from "../src/lib/vault/frontmatter"
import { paperKey } from "../src/lib/papers/types"
import { sanitizeSlug } from "../src/lib/wiki/acquire"

// A real one-page PDF, generated entirely from synthetic test text.
function fixturePdf(title: string): Uint8Array {
  const stream = `BT /F1 14 Tf 50 700 Td (${title}) Tj 0 -30 Td (Methods and results from the saved full text.) Tj ET`
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let pdf = "%PDF-1.4\n", offsets = "0000000000 65535 f \n"
  objects.forEach((body, i) => {
    offsets += `${String(Buffer.byteLength(pdf)).padStart(10, "0")} 00000 n \n`
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  return Buffer.from(`${pdf}xref\n0 6\n${offsets}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
}

test("an old failed acquisition never blocks reading a saved PDF after ingestion", async ({ page }, info) => {
  const storage = new NodeFsVaultStorage(process.env.SCISPARK_E2E_VAULT_PATH!)
  const paper = { ids: { arxiv: "fulltext-regression" }, title: "Saved PDF reader regression", authors: [], fields: [], source: "arxiv" as const }
  const draft = buildPaperPage(paper, { fullText: false, status: "ingested", today: "2026-10-04" })
  const slug = paperSlug(paper)
  await storage.write(draft.path, serializeDocument(draft.frontmatter, draft.body))
  await storage.writeBinary(`sources/${sanitizeSlug(paperKey(paper))}.pdf`, fixturePdf(paper.title))
  const remoteFetches: string[] = []
  const paperActions: string[] = []
  page.on("request", req => {
    if (req.url().includes("/api/fetch?")) remoteFetches.push(req.url())
    // The shell separately checks proactive companion notifications on navigation.
    if (req.method() === "POST" && /\/api\/skills\/(?:digest|enrich|ingest|chat|ask)(?:[/?]|$)/.test(req.url())) paperActions.push(req.url())
  })
  await page.goto(`/paper/${slug}`)
  await expect(page.getByText("In your knowledge base", { exact: true })).toBeVisible()
  await expect(page.getByText("No open-access full text.", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Read full text", exact: true }).click()
  await expect(page).toHaveURL(/\/reader\?paperKey=/)
  const textLayer = page.locator('[data-page-index="0"]')
  await expect(textLayer).toContainText("Methods and results from the saved full text.")
  await expect(page.getByRole("main").locator("canvas")).toBeVisible()
  await expect(page.getByText("Loading PDF…", { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("ingested-paper-pdf.png") })
  await page.reload()
  await expect(textLayer).toContainText(paper.title)
  await page.goto(`/paper/${slug}`)
  await expect(page.getByRole("button", { name: "Read full text", exact: true })).toBeEnabled()
  expect(remoteFetches).toEqual([])
  expect(paperActions).toEqual([])
  // Reading does not rewrite the user's historical wiki entry to hide the bug.
  expect(await storage.read(draft.path)).toBe(serializeDocument(draft.frontmatter, draft.body))
})
