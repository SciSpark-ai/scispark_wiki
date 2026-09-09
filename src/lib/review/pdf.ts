import { spawn } from "node:child_process"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import { hashReviewData } from "./budget"
import { contextOverlap } from "./context"
import { updateReview, REVIEW_DIR, loadReview } from "./store"

const Extracted = z.object({ text: z.string().min(100).max(45_000), pagesRead: z.number().int(), totalPages: z.number().int(), shortened: z.boolean() })
export async function extractReviewPdf(bytes: Uint8Array): Promise<z.infer<typeof Extracted>> {
  if (bytes.length > 5_000_000 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") throw new Error("Choose a PDF up to 5 MB")
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "scripts/review-pdf-worker.mjs")], {
      stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV, NODE_NO_WARNINGS: "1" },
    })
    let output = "", error = ""
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("PDF extraction timed out. Try a smaller document.")) }, 20_000)
    child.stdout.on("data", (data) => { output += data; if (output.length > 300_000) child.kill("SIGKILL") })
    child.stderr.on("data", (data) => { error = (error + data).slice(0, 1000) })
    child.stdin.on("error", () => {})
    child.on("error", () => { clearTimeout(timer); reject(new Error("PDF extraction process unavailable")) })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) { reject(new Error(/OCR|password/i.test(error) ? "This PDF is scanned or password-protected. Supply readable, unlocked text." : "Could not extract this PDF. Your current review is unchanged.")); return }
      try { resolve(Extracted.parse(JSON.parse(output))) } catch { reject(new Error("Invalid PDF extraction output")) }
    })
    child.stdin.end(Buffer.from(bytes).toString("base64"))
  })
}

/** Uploads are approved input, never a license/paywall bypass. Publication
 * identity is supplied by the user and cross-checked against extracted text. */
export async function attachReviewPdf(storage: VaultStorage, id: string, revision: number, file: { bytes: Uint8Array; name: string; title: string; doi?: string }, extract = extractReviewPdf) {
  const before = await loadReview(storage, id)
  if (before.status !== "awaiting-approval" || before.approvedRevision !== null || before.revision !== revision) throw new Error("Attach PDFs to a new brief before starting. Existing reports keep their original sources.")
  const title = z.string().trim().min(10).max(500).parse(file.title)
  const doi = file.doi?.trim() || undefined
  if (doi && !/^10\.\d{4,9}\/\S{1,200}$/i.test(doi)) throw new Error("Enter a valid DOI or leave it blank")
  if (file.bytes.length > 5_000_000) throw new Error("Choose a PDF up to 5 MB")
  const extracted = await extract(file.bytes)
  if (contextOverlap(title, extracted.text.slice(0, 8000)) < Math.min(4, title.split(/\s+/).length)) throw new Error("The title does not match the extracted PDF. Check the paper and title before attaching.")
  const hash = createHash("sha256").update(file.bytes).digest("hex")
  const name = file.name.replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 120) || "paper.pdf"
  return updateReview(storage, id, async (run) => {
    if (run.revision !== revision || run.approvedRevision !== null) throw new Error("The brief changed while extracting. Try attaching again.")
    if (run.uploads.some((u) => u.hash === hash)) return
    if (run.uploads.length >= 4) throw new Error("Attach at most four PDFs to one review")
    await storage.writeBinary(`${REVIEW_DIR}/${id}/uploads/${hash}.pdf`, file.bytes)
    const ids = doi ? { doi } : {}
    run.uploads.push({ hash, name, record: { id: "P0", title, text: extracted.text, access: "uploaded-pdf", locator: `Uploaded PDF: ${name}`,
      hash: hashReviewData(extracted.text), retrievedAt: new Date().toISOString(), paper: { ids, title, authors: [], source: "uploaded", fields: [] },
      notes: [`User-supplied PDF; bibliographic details require checking. Read ${extracted.pagesRead} of ${extracted.totalPages} pages.`, ...(extracted.shortened ? ["PDF text shortened at the reading limit; later content was not read"] : [])] } })
  })
}
