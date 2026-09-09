// Isolated, bounded text extraction. No URLs, scripts, or remote resources are
// accepted. The parent kills this disposable process on timeout/output limits.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
let input = ""
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 7_100_000) throw new Error("PDF exceeds extraction limit")
}
let task
try {
  const bytes = Buffer.from(input, "base64")
  if (bytes.length > 5_000_000 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Not a supported PDF")
  task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 })
  const pdf = await task.promise
  const pages = []
  let length = 0
  for (let i = 1; i <= Math.min(pdf.numPages, 50) && length < 45_000; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.filter((item) => "str" in item).map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("").trim()
    pages.push(`[PDF page ${i}]\n${text}`); length += text.length
    page.cleanup()
  }
  const text = pages.join("\n\n").slice(0, 45_000)
  if (text.replace(/\[PDF page \d+\]/g, "").trim().length < 100) throw new Error("No readable text. Scanned PDFs need OCR before upload.")
  process.stdout.write(JSON.stringify({ text, pagesRead: pages.length, totalPages: pdf.numPages, shortened: pages.length < pdf.numPages || length > 45_000 }))
} catch (error) {
  process.stderr.write(error instanceof Error && /password|OCR|supported/i.test(error.message) ? error.message : "Could not extract readable PDF text")
  process.exitCode = 1
} finally { await task?.destroy() }
