import { paperKey, type PaperRecord } from "../papers/types"
import type { VaultStorage } from "../vault/storage"
import {
  acquireFullText,
  relayUrl,
  sanitizeSlug,
  snapshotSource,
  type AcquireFullTextDeps,
} from "../wiki/acquire"

export type ReaderContent =
  | { kind: "html"; html: string; sourceUrl?: string; snapshotPath: string }
  | { kind: "pdf"; bytes: Uint8Array; snapshotPath: string }
  | { kind: "none"; reason: string }

const UNAVAILABLE_REASON = "Full text unavailable (paywalled or no open-access HTML)."

function htmlSnapshotPath(paper: PaperRecord): string {
  return `sources/${sanitizeSlug(paperKey(paper))}.html`
}

function pdfSnapshotPath(paper: PaperRecord): string {
  return `sources/${sanitizeSlug(paperKey(paper))}.pdf`
}

/**
 * Resolves a paper's readable content for the in-app reader.
 *
 * Resolution order:
 *  1. sources/<slug>.html already exists -> return it, no network at all.
 *  2. sources/<slug>.pdf already exists -> return its bytes, no network.
 *  3. Otherwise fall through to the M4 acquire relay pipeline
 *     (acquireRelayContent): an html result gets snapshotted and returned;
 *     an abstract-only result tries one pdf candidate via the relay
 *     (fetchPdfCandidate) before giving up with kind "none".
 *
 * Never throws: every network-touching branch is wrapped so a failure
 * anywhere below this function maps to {kind:"none", reason}, never an
 * exception the caller has to guard against.
 */
export async function loadReaderContent(
  storage: VaultStorage,
  paper: PaperRecord,
  deps?: AcquireFullTextDeps,
): Promise<ReaderContent> {
  const htmlPath = htmlSnapshotPath(paper)
  const htmlSnapshot = await storage.read(htmlPath)
  if (htmlSnapshot != null) {
    return { kind: "html", html: htmlSnapshot, snapshotPath: htmlPath }
  }

  const pdfPath = pdfSnapshotPath(paper)
  const pdfSnapshot = await storage.readBinary(pdfPath)
  if (pdfSnapshot != null) {
    return { kind: "pdf", bytes: pdfSnapshot, snapshotPath: pdfPath }
  }

  return acquireRelayContent(storage, paper, deps)
}

/**
 * The network-touching branch of loadReaderContent, split out from the
 * snapshot-hit fast paths above so it stands alone as a unit (and so a
 * future change to the acquire step doesn't risk touching the no-network
 * paths). Tries acquireFullText's html path first (the reader's primary
 * surface); if that lands on abstract-only, tries one pdf candidate via
 * fetchPdfCandidate before giving up. Wrapped in try/catch as a second line
 * of defense on top of acquireFullText's own internal per-candidate error
 * handling, so this function can never throw regardless of how acquire.ts
 * evolves.
 */
async function acquireRelayContent(
  storage: VaultStorage,
  paper: PaperRecord,
  deps?: AcquireFullTextDeps,
): Promise<ReaderContent> {
  try {
    const result = await acquireFullText(paper, deps)
    if (result.kind === "html" && result.html != null) {
      const snapshotPath = await snapshotSource(storage, paper, result.html)
      return { kind: "html", html: result.html, sourceUrl: result.sourceUrl, snapshotPath }
    }

    const pdf = await fetchPdfCandidate(storage, paper, deps)
    if (pdf) {
      return { kind: "pdf", bytes: pdf.bytes, snapshotPath: pdf.snapshotPath }
    }

    return { kind: "none", reason: UNAVAILABLE_REASON }
  } catch {
    return { kind: "none", reason: UNAVAILABLE_REASON }
  }
}

/**
 * Fetches paper.pdfUrl through the M3 /api/fetch relay (same relay
 * acquireFullText uses for its html candidates) and, only if the response
 * is actually application/pdf, snapshots the bytes to sources/<slug>.pdf
 * and returns them. Returns null (never throws) when the paper has no pdf
 * candidate, the relay request fails, the status isn't 200, or the
 * response's content-type isn't application/pdf — callers fall through to
 * the abstract-only "none" outcome. Kept as its own named helper (v1: the
 * only pdf acquisition path, since acquireFullText itself intentionally
 * never reads paper.pdfUrl per its own module doc) so Task 6's PDF surface
 * work can exercise or extend it directly.
 */
async function fetchPdfCandidate(
  storage: VaultStorage,
  paper: PaperRecord,
  deps: AcquireFullTextDeps = {},
): Promise<{ bytes: Uint8Array; snapshotPath: string } | null> {
  if (!paper.pdfUrl) return null

  const fetchFn = deps.fetchFn ?? fetch
  const apiBase = deps.apiBase ?? ""

  let response: Response
  try {
    response = await fetchFn(relayUrl(apiBase, paper.pdfUrl))
  } catch {
    return null
  }
  if (response.status !== 200) return null

  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()
  if (contentType !== "application/pdf") return null

  const bytes = new Uint8Array(await response.arrayBuffer())
  const snapshotPath = pdfSnapshotPath(paper)
  await storage.writeBinary(snapshotPath, bytes)
  return { bytes, snapshotPath }
}
