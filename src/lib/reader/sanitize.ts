import DOMPurify from "dompurify"

/**
 * Sanitizes untrusted paper HTML (arXiv/PMC full text relayed through the M4
 * acquire pipeline — see the M6 plan's Global Constraints: "Paper full text
 * and paper HTML are untrusted input") before it is ever rendered via
 * `dangerouslySetInnerHTML` in `HtmlSurface`.
 *
 * Security posture is allowlist-first: only a fixed set of structural tags
 * and a single `href` attribute are permitted at all (`ALLOWED_TAGS`/
 * `ALLOWED_ATTR`), so nothing outside that set — including every `on*`
 * event-handler attribute and `style` — can ever survive regardless of how
 * it's spelled; `FORBID_TAGS`/`FORBID_ATTR` are layered on top as
 * defense-in-depth documentation of the specific things the plan calls out
 * (script/style/iframe/object/embed/img, style attribute). No tag in the
 * allowlist can cause an external network request: `<img>` is dropped
 * entirely (see the `uponSanitizeElement` hook below, registered once at
 * module scope so repeated calls don't stack hooks) and replaced with a
 * `[figure]` placeholder `<span>` rather than silently vanishing, and
 * `href` values go through DOMPurify's own `ALLOWED_URI_REGEXP` protocol
 * check, which strips `javascript:`/`data:`-style hrefs.
 *
 * Must only ever be called in a browser context (a DOM `window` must exist)
 * — this module never constructs its own jsdom window; see the M6 Task 7
 * brief. In this codebase that means: called from a client component after
 * paper content has loaded (see `HtmlSurface`), never at module-eval time or
 * during server rendering.
 */

const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "figure",
  "figcaption",
  "code",
  "pre",
  "em",
  "strong",
  "sup",
  "sub",
  "a",
  "br",
  "span",
]

// `class` is inert (it can't execute anything, and the paper's own stylesheet is
// stripped, so surviving paper classes are no-ops) — it's allowed only so the
// reader's own typography can target the `[figure]` placeholder span below and
// so the surface can carry structural hooks. `style` remains forbidden.
const ALLOWED_ATTR = ["href", "class"]

const FORBID_TAGS = ["script", "style", "iframe", "object", "embed", "img"]
const FORBID_ATTR = [
  "style",
  "onclick",
  "onerror",
  "onload",
  "onmouseover",
  "onmouseout",
  "onfocus",
  "onblur",
  "onchange",
  "onsubmit",
  "onkeydown",
  "onkeyup",
  "onkeypress",
]

const FIGURE_PLACEHOLDER_TEXT = "[figure]"

let hookRegistered = false

/**
 * Replaces any `<img>` element with an inert `[figure]` placeholder span
 * *before* DOMPurify's own forbidden-tag removal runs, so a dropped image
 * leaves a visible trace in the rendered output instead of disappearing
 * silently. Registered exactly once per module load (DOMPurify's hook list
 * is a singleton on the default export) — calling `sanitizePaperHtml`
 * repeatedly must never accumulate duplicate hooks.
 */
function ensureImgPlaceholderHook(): void {
  if (hookRegistered) return
  hookRegistered = true
  DOMPurify.addHook("uponSanitizeElement", (node) => {
    const element = node as unknown as Element
    if (element.nodeType !== 1) return
    if (element.tagName?.toLowerCase() !== "img") return
    const placeholder = element.ownerDocument.createElement("span")
    placeholder.textContent = FIGURE_PLACEHOLDER_TEXT
    placeholder.setAttribute("class", "reader-figure-placeholder")
    element.parentNode?.replaceChild(placeholder, element)
  })
}

/**
 * Sanitizes `html` down to a safe structural subset for the in-app reader.
 * Pure function of its input (DOMPurify's own config is fixed here, not
 * caller-tunable) — same input always yields the same output.
 */
export function sanitizePaperHtml(html: string): string {
  ensureImgPlaceholderHook()
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  })
}
