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
export function relayUrl(apiBase: string, target: string): string {
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

  const rawCandidates: string[] = []
  if (paper.ids.arxiv) rawCandidates.push(`https://arxiv.org/html/${paper.ids.arxiv}`)
  if (paper.htmlUrl) rawCandidates.push(paper.htmlUrl)
  if (paper.oaUrl) rawCandidates.push(paper.oaUrl)
  // Dedupe (order-preserving): htmlUrl and oaUrl are sometimes the same
  // landing page, and a Set over the URL strings avoids a wasted relay
  // round-trip fetching the identical target twice.
  const candidates = Array.from(new Set(rawCandidates))

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

// Block removal is start-marker-to-close-marker-or-end-of-string, so it
// never needs to identify where the *opening* tag ends - attribute values
// containing a literal `>` (legal HTML5) can't confuse it, and an unclosed
// block (e.g. truncated by a flaky upstream fetch) masks to end-of-string
// instead of falling through to per-tag stripping and leaking its raw
// content (same shape of fix as the vault's code-fence hardening).
const BLOCK_CONTAINER_TAGS = /<(script|style|nav|header|footer)\b[\s\S]*?(?:<\/\1\s*>|$)/gi

// HTML comments and bang declarations (<!DOCTYPE ...>) aren't "tags" per
// ANY_TAG's `<\/?[a-zA-Z]...>` shape (they start with `<!`), so they need
// their own removal pass - matches the old catch-all ANY_TAG's behavior of
// silently dropping them too.
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const DOCTYPE_DECLARATION = /<![^>]*>/g

// Quoted-attribute-aware tag tail: consumes non->/quote chars, or a fully
// quoted attribute value (which may itself contain `>`), repeated, so a
// `>` inside a quoted attribute value doesn't truncate the match early and
// leak the rest of the tag (and any trailing content up to the next real
// `>`) into the output.
const ATTR_AWARE_TAIL = String.raw`[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*`
const BLOCK_BOUNDARY_OPEN = new RegExp(
  String.raw`<\s*(?:p|div|li|h[1-6])\b${ATTR_AWARE_TAIL}>`,
  "gi",
)
const BLOCK_BOUNDARY_CLOSE = /<\s*\/\s*(p|div|li|h[1-6])\s*>/gi
const LINE_BREAK_TAG = /<\s*br\s*\/?\s*>/gi
const ANY_TAG = new RegExp(String.raw`<\/?[a-zA-Z]${ATTR_AWARE_TAIL}>`, "g")

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

const BLOCK_TEXT_SELECTOR = "p, br, div, li, h1, h2, h3, h4, h5, h6, tr"
const STRIP_SELECTOR = "script, style, nav, header, footer"

/**
 * Converts raw HTML into plain readable text. Output contract (shared by
 * both engines below): paragraph/heading/list-item/row breaks are preserved
 * as newlines, script/style/nav/header/footer content is fully absent,
 * entities are decoded, intra-line whitespace is collapsed, and blank-line
 * runs are capped at one blank line.
 *
 * Browser-primary: when `globalThis.DOMParser` exists, use it -
 * `extractReadableTextDom` is not vulnerable to either of the regex
 * fallback's failure modes (a quoted attribute containing a literal `>`, or
 * an unclosed block tag), since a real HTML parser resolves tag boundaries
 * correctly regardless of attribute content or malformed markup.
 *
 * Node fallback (and any environment without DOMParser):
 * `extractReadableTextRegex`, hardened per the two reviewer-reported
 * corruptions - see its own doc comment.
 */
export function extractReadableText(html: string): string {
  if (typeof globalThis.DOMParser !== "undefined") {
    return extractReadableTextDom(html)
  }
  return extractReadableTextRegex(html)
}

/**
 * Browser-primary DOM-based extraction. Parses `html` as text/html, removes
 * script/style/nav/header/footer elements outright, then inserts a newline
 * text node at the end of every block-level element (p, br, div, li,
 * h1-h6, tr) before reading `body.textContent`, so paragraph/row boundaries
 * survive as line breaks the same way the regex path's boundary markers do.
 * A real parser means attribute values containing `>` and malformed/
 * unclosed tags can't corrupt the output the way the regex fallback's naive
 * tag-matching can.
 */
function extractReadableTextDom(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove())
  doc.querySelectorAll(BLOCK_TEXT_SELECTOR).forEach((el) => {
    el.appendChild(doc.createTextNode("\n"))
  })
  return collapseWhitespace(doc.body?.textContent ?? "")
}

/**
 * Hardened regex/string fallback (Node + any DOMParser-less environment).
 * This is the path exercised directly by tests in a plain Node vitest
 * environment (no jsdom/happy-dom in devDeps), so it must be correct on its
 * own, not just "good enough until DOMParser is available":
 * 1. Strips entire <script>/<style>/<nav>/<header>/<footer> blocks
 *    including their content. Matching is "open tag -> matching close tag
 *    -or- end of string", not "open tag -> next occurrence of the tag
 *    name's own close tag with a bounded attribute scanner" - so an
 *    unclosed block (upstream truncation, malformed source) masks
 *    everything through end-of-string instead of leaking raw script/style
 *    source as if it were readable text.
 * 2. Converts <br> and the open/close boundaries of <p>/<div>/<li>/
 *    <h1..h6> into newlines *before* stripping tags, so paragraph/heading/
 *    list-item structure survives as line breaks. The opening-tag boundary
 *    matcher is quoted-attribute-aware (see ATTR_AWARE_TAIL) so a literal
 *    `>` inside a quoted attribute value doesn't truncate the match early.
 * 3. Strips all remaining tags, using the same quoted-attribute-aware
 *    tail so an unescaped `>` inside a quoted attribute doesn't leak the
 *    attribute tail (and everything up to the next real `>`) into the
 *    output.
 * 4. Decodes entities in a single combined regex pass (numeric `&#NNN;`/
 *    `&#xHHH;` plus the five named entities) to avoid double-decoding a
 *    chained entity like `&amp;lt;` into `<` instead of the correct `&lt;`.
 * 5. Collapses intra-line whitespace and caps blank-line runs at one blank
 *    line.
 */
export function extractReadableTextRegex(html: string): string {
  let text = html.replace(HTML_COMMENT, "")
  text = text.replace(DOCTYPE_DECLARATION, "")
  text = text.replace(BLOCK_CONTAINER_TAGS, "")
  text = text.replace(LINE_BREAK_TAG, "\n")
  text = text.replace(BLOCK_BOUNDARY_OPEN, "\n")
  text = text.replace(BLOCK_BOUNDARY_CLOSE, "\n")
  text = text.replace(ANY_TAG, "")
  text = decodeEntities(text)
  return collapseWhitespace(text)
}

function collapseWhitespace(text: string): string {
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
export function sanitizeSlug(key: string): string {
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
