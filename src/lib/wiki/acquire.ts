import { paperKey, type PaperRecord } from "../papers/types"
import type { VaultStorage } from "../vault/storage"

const MIN_TEXT_LENGTH = 500
const HTML_CONTENT_TYPE_PREFIXES = ["text/html", "application/xhtml"]
const MAX_SLUG_LENGTH = 100

export interface AcquireFullTextDeps {
  fetchFn?: typeof fetch
  /** Prefix for relayed calls; "" (default) assumes browser same-origin. */
  apiBase?: string
}

export interface AcquireFullTextResult {
  kind: "html" | "abstract"
  text: string
  /** Present only when kind is "html": the raw HTML of the winning candidate. */
  html?: string
  /** Present only when kind is "html": the original (non-relay-wrapped) candidate URL. */
  sourceUrl?: string
}

interface ResolveResponseBody {
  oaUrl?: string
  // pdfUrl is intentionally never read here: PDF extraction is out of scope
  // for M4 and lands in M6, so a resolve response's pdfUrl (or the paper's
  // own pdfUrl/PDF-typed candidates) is never a fetch candidate in this file.
}

/**
 * Builds the relay-wrapped URL for a remote target. Every remote fetch in
 * this module goes through the M3 /api/fetch relay rather than hitting the
 * target host directly (CORS + the relay's allowlist/rate-limit/SSRF guards).
 */
function relayUrl(apiBase: string, target: string): string {
  return `${apiBase}/api/fetch?url=${encodeURIComponent(target)}`
}

function isHtmlLike(contentType: string | null): boolean {
  if (!contentType) return false
  const prefix = contentType.split(";")[0].trim().toLowerCase()
  return HTML_CONTENT_TYPE_PREFIXES.some((p) => prefix === p || prefix.startsWith(p))
}

/**
 * Fetches one candidate URL via the relay and returns its raw HTML, or null
 * if the candidate should be skipped (network failure, non-200 status, or a
 * content-type that isn't html-ish). Text-length screening happens in the
 * caller, since the >=500-char guard applies to extracted text, not raw
 * HTML.
 */
async function fetchCandidateHtml(
  target: string,
  fetchFn: typeof fetch,
  apiBase: string,
): Promise<string | null> {
  let response: Response
  try {
    response = await fetchFn(relayUrl(apiBase, target))
  } catch {
    return null
  }
  if (response.status !== 200) return null
  if (!isHtmlLike(response.headers.get("content-type"))) return null
  return response.text()
}

/**
 * Resolves a DOI via /api/resolve (not the /api/fetch relay - this is our
 * own same-origin JSON endpoint, already talking to Unpaywall server-side).
 * Returns null on any network failure or non-200 status.
 */
async function resolveDoi(
  doi: string,
  fetchFn: typeof fetch,
  apiBase: string,
): Promise<ResolveResponseBody | null> {
  let response: Response
  try {
    response = await fetchFn(`${apiBase}/api/resolve?doi=${encodeURIComponent(doi)}`)
  } catch {
    return null
  }
  if (response.status !== 200) return null
  try {
    return (await response.json()) as ResolveResponseBody
  } catch {
    return null
  }
}

/**
 * Tries one candidate URL end to end: fetch via relay, extract readable
 * text, and screen for the >=500-char minimum. Returns the mapped success
 * result, or null if this candidate should be skipped.
 */
async function tryCandidate(
  target: string,
  fetchFn: typeof fetch,
  apiBase: string,
): Promise<AcquireFullTextResult | null> {
  const html = await fetchCandidateHtml(target, fetchFn, apiBase)
  if (html == null) return null
  const text = extractReadableText(html)
  if (text.length < MIN_TEXT_LENGTH) return null
  return { kind: "html", text, html, sourceUrl: target }
}

/**
 * Acquires full text for a paper, client-side, entirely through the M3
 * relay (never a direct cross-origin fetch from the browser). Candidate
 * order: arXiv's own HTML mirror (when ids.arxiv is known) -> paper.htmlUrl
 * -> paper.oaUrl. If none of those succeed and the paper has a DOI, falls
 * back to resolving the DOI via /api/resolve and trying its oaUrl (never
 * its pdfUrl/url_for_pdf - PDF extraction is out of scope until M6). If
 * every candidate fails, falls back to the paper's existing abstract.
 */
export async function acquireFullText(
  paper: PaperRecord,
  deps: AcquireFullTextDeps = {},
): Promise<AcquireFullTextResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const apiBase = deps.apiBase ?? ""

  const candidates: string[] = []
  if (paper.ids.arxiv) candidates.push(`https://arxiv.org/html/${paper.ids.arxiv}`)
  if (paper.htmlUrl) candidates.push(paper.htmlUrl)
  if (paper.oaUrl) candidates.push(paper.oaUrl)

  for (const target of candidates) {
    const result = await tryCandidate(target, fetchFn, apiBase)
    if (result) return result
  }

  // Reaching here means every htmlUrl/oaUrl (and arXiv) candidate failed.
  if (paper.ids.doi) {
    const resolved = await resolveDoi(paper.ids.doi, fetchFn, apiBase)
    if (resolved?.oaUrl) {
      const result = await tryCandidate(resolved.oaUrl, fetchFn, apiBase)
      if (result) return result
    }
  }

  return { kind: "abstract", text: paper.abstract ?? "" }
}

const BLOCK_CONTAINER_TAGS = /<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi
const BLOCK_BOUNDARY_OPEN = /<\s*(p|div|li|h[1-6])\b[^>]*>/gi
const BLOCK_BOUNDARY_CLOSE = /<\s*\/\s*(p|div|li|h[1-6])\s*>/gi
const LINE_BREAK_TAG = /<\s*br\s*\/?\s*>/gi
const ANY_TAG = /<[^>]+>/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

/**
 * Decodes the small set of entities the brief calls for: the five basic
 * named entities (&amp; &lt; &gt; &quot; &#39; via apos), plus numeric
 * character references (&#NNN; and &#xHHH;) using the same approach as the
 * arXiv adapter's decodeNumericEntities. A single combined pass (rather than
 * three separate .replace calls) avoids double-decoding chained entities
 * like "&amp;lt;" into "<" instead of the correct "&lt;".
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9A-Fa-f]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X"
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isNaN(code) ? match : String.fromCharCode(code)
    }
    const name = body.toLowerCase()
    return name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : match
  })
}

/**
 * Converts raw HTML into plain readable text. Pure regex/string
 * manipulation (no DOMParser) so it runs identically in Node tests and in
 * the browser: (1) drop entire <script>/<style>/<nav>/<header>/<footer>
 * blocks, including their content; (2) turn block-level element boundaries
 * (<p> <div> <li> <h1..h6> <br>) into newlines so paragraph structure
 * survives tag stripping; (3) strip all remaining tags; (4) decode basic
 * HTML entities; (5) collapse intra-line whitespace and cap blank-line runs
 * at one blank line (i.e. at most two consecutive newlines).
 */
export function extractReadableText(html: string): string {
  let text = html.replace(BLOCK_CONTAINER_TAGS, "")
  text = text.replace(LINE_BREAK_TAG, "\n")
  text = text.replace(BLOCK_BOUNDARY_OPEN, "\n")
  text = text.replace(BLOCK_BOUNDARY_CLOSE, "\n")
  text = text.replace(ANY_TAG, "")
  text = decodeEntities(text)

  const collapsedLines = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")

  return collapsedLines.replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Sanitizes a paperKey into a filesystem-safe slug: lowercase, any run of
 * non [a-z0-9] characters collapsed to a single "-", leading/trailing "-"
 * trimmed, then capped at 100 characters (re-trimming any "-" left dangling
 * by the truncation).
 */
function sanitizeSlug(key: string): string {
  const collapsed = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return collapsed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "")
}

/**
 * Writes a raw HTML snapshot of a paper's acquired source to the vault's
 * immutable sources/ directory and returns the path written. Path shape:
 * sources/<sanitized paperKey>.html.
 */
export async function snapshotSource(
  storage: VaultStorage,
  paper: PaperRecord,
  html: string,
): Promise<string> {
  const slug = sanitizeSlug(paperKey(paper))
  const path = `sources/${slug}.html`
  await storage.write(path, html)
  return path
}
