import type { VaultStorage } from "../vault/storage"
import { extractReadableText, sanitizeSlug } from "../wiki/acquire"
import { acquireReviewEvidence, isArticleText } from "../review/acquisition"
import { extractReviewPdf } from "../review/pdf"
import { serverRelayFetch } from "../server/relay-fetch"
import { normalizeDoi, paperKey, type PaperRecord } from "./types"
import { PaperTextSchema, type PaperText } from "./text-contract"

export interface PaperTextDeps { fetchFn?: typeof fetch; extractPdf?: typeof extractReviewPdf; now?: () => Date; onSnapshot?: () => void }

/** Discovery providers often identify arXiv papers by DOI alone. Keep that
 * identity unchanged; derive acquisition candidates only. */
function acquisitionPaper(paper: PaperRecord): PaperRecord {
  const id = paper.ids.arxiv ?? normalizeDoi(paper.ids.doi)?.match(/^10\.48550\/arxiv\.(.+)$/)?.[1]
  if (!id || !/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(id)) return paper
  return { ...paper, ids: { ...paper.ids, arxiv: id }, pdfUrl: paper.pdfUrl ?? `https://arxiv.org/pdf/${id}` }
}

/** Server-only, model-free source acquisition shared by digest, ingest and paper chat.
 * Reuses downloaded HTML/PDF and bounded extraction; all remote fetches keep the
 * existing relay, identity checks, timeouts and byte limits. */
export async function loadPaperText(storage: VaultStorage, paper: PaperRecord, deps: PaperTextDeps = {}): Promise<PaperText> {
  const key = paperKey(paper)
  const stem = sanitizeSlug(key)
  const cachePath = `.scispark/paper-text/${stem}.json`
  const checkedAt = (deps.now?.() ?? new Date()).toISOString()
  try {
    const cached = PaperTextSchema.safeParse(JSON.parse(await storage.read(cachePath) ?? "null"))
    if (cached.success && cached.data.paperKey === key && cached.data.access === "full-text") return cached.data
  } catch { /* A derived cache failure does not prevent reading the source. */ }
  async function remember(source: PaperText) {
    if (source.access === "full-text") {
      try { await storage.write(cachePath, JSON.stringify(source)) } catch { /* Still use the acquired text. */ }
    }
    return source
  }
  const notes: string[] = []
  try {
    const html = await storage.read(`sources/${stem}.html`)
    if (html) {
      const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)?.[0]
      const text = extractReadableText(article ?? html)
      if (isArticleText(paper, text)) return remember({ paperKey: key, access: "full-text", text: text.slice(0, 45_000), locator: `sources/${stem}.html`, checkedAt, truncated: text.length > 45_000, notes: text.length > 45_000 ? ["Article text shortened to 45,000 characters; later content was not read."] : [] })
      notes.push("Saved HTML did not contain a verified article body.")
    }
    const pdf = await storage.readBinary(`sources/${stem}.pdf`)
    if (pdf) {
      const extracted = await (deps.extractPdf ?? extractReviewPdf)(pdf)
      if (isArticleText(paper, extracted.text)) return remember({ paperKey: key, access: "full-text", text: extracted.text, locator: `sources/${stem}.pdf`, checkedAt, truncated: extracted.shortened,
        notes: [`Saved PDF: read ${extracted.pagesRead} of ${extracted.totalPages} pages.`, ...(extracted.shortened ? ["PDF shortened at the reading limit; later content was not read."] : [])] })
      notes.push("Saved PDF did not match the paper title and article body.")
    }
  } catch { notes.push("Saved full text could not be extracted; tried public sources.") }

  const evidence = await acquireReviewEvidence(acquisitionPaper(paper), "P1",
    deps.fetchFn ?? serverRelayFetch("server-paper-text", { maxBytes: 5_000_000, timeoutMs: 10_000 }), deps.extractPdf ?? extractReviewPdf,
    async ({ kind, bytes }) => {
      deps.onSnapshot?.()
      const path = `sources/${stem}.${kind}`
      if (kind === "pdf") await storage.writeBinary(path, bytes)
      else await storage.write(path, new TextDecoder().decode(bytes))
    })
  const full = evidence?.access === "full-text"
  return remember({ paperKey: key, access: full ? "full-text" : "abstract", text: (full ? evidence.text : paper.abstract ?? "").slice(0, 45_000),
    locator: full ? evidence.locator : "Abstract", checkedAt,
    truncated: full ? evidence.notes.some(note => /shortened|later.*not read/i.test(note)) : (paper.abstract?.length ?? 0) > 45_000,
    notes: [...notes, ...(evidence?.notes ?? []), ...(!full ? ["Full text was not retrieved or verified. This does not establish that it is inaccessible."] : [])] })
}
