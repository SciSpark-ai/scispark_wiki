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
  // `img` is allowed structurally, but the hook below is the real gate:
  // an <img> only survives when the caller-provided resolver rewrites its
  // src to a same-host /api/fetch relay URL — everything else becomes the
  // inert `[figure]` placeholder (and with no resolver, everything does).
  "img",
  // MathML Core presentation markup — browsers render it natively (zero
  // JS), which is how LaTeXML equations display. All-inert: MathML carries
  // no scripts and no URL-bearing attributes in this subset. `semantics`
  // renders only its first child (the presentation tree); the annotation
  // channels that ride along in LaTeXML output are FORBIDDEN below, with
  // their contents.
  "math",
  "semantics",
  "mrow",
  "mi",
  "mn",
  "mo",
  "ms",
  "mspace",
  "mtext",
  "merror",
  "mfrac",
  "mpadded",
  "mphantom",
  "mroot",
  "msqrt",
  "mstyle",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mmultiscripts",
  "mprescripts",
  "mtable",
  "mtr",
  "mtd",
]

// `class` is inert (it can't execute anything, and the paper's own stylesheet is
// stripped, so surviving paper classes are no-ops) — it's allowed only so the
// reader's own typography can target the `[figure]` placeholder span below and
// so the surface can carry structural hooks. `style` remains forbidden.
// The MathML attributes are the inert presentational subset MathML Core
// reads (display/stretchy/accent/…); none carries a URL or code.
const ALLOWED_ATTR = [
  "href",
  "class",
  // <img> attributes — src survives only as the resolver's relay URL (see
  // the hook); alt/width/height are inert and keep layout stable while
  // images lazy-load.
  "src",
  "alt",
  "loading",
  // MathML Core presentation attributes
  "display",
  "alttext",
  "mathvariant",
  "displaystyle",
  "scriptlevel",
  "stretchy",
  "symmetric",
  "largeop",
  "movablelimits",
  "form",
  "separator",
  "accent",
  "accentunder",
  "linethickness",
  "rowspan",
  "columnspan",
  "rowalign",
  "columnalign",
  "rowspacing",
  "columnspacing",
  "depth",
  "height",
  "width",
  "lspace",
  "rspace",
  "voffset",
]

// `annotation`/`annotation-xml` are LaTeXML's side channels (raw LaTeX
// source + content-MathML) riding inside <semantics>; annotation-xml in
// particular is the classic MathML namespace-confusion mXSS vector, and
// KEEP_CONTENT would otherwise leak the LaTeX source as visible text. Both
// are forbidden together with their CONTENTS (see FORBID_CONTENTS below).
const FORBID_TAGS = ["script", "style", "iframe", "object", "embed", "annotation", "annotation-xml"]

// Passing FORBID_CONTENTS REPLACES DOMPurify's default list, so the
// dangerous-content classes from the default list that matter here are
// restated explicitly alongside the two annotation channels.
const FORBID_CONTENTS = [
  "annotation",
  "annotation-xml",
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "title",
  "head",
  "svg",
]
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

export interface SanitizePaperHtmlOptions {
  /**
   * Maps a raw `<img src>` value to a same-host `/api/fetch` relay URL, or
   * `null` for "don't render this image" (→ `[figure]` placeholder). See
   * `buildFigureSrcResolver` in `figures.ts`. When omitted, every image
   * becomes a placeholder — the pre-figures behavior, and the safe default.
   */
  resolveImageSrc?: (rawSrc: string) => string | null
}

// The hook (a module-scope singleton, see ensureImgHook) reads the resolver
// through this holder, set for the duration of each sanitize call —
// DOMPurify.sanitize is synchronous, so there is no window where a stale
// resolver could apply to another document.
let currentResolveImageSrc: SanitizePaperHtmlOptions["resolveImageSrc"] | null = null

let hookRegistered = false

/**
 * Rewrites or replaces every `<img>` *before* DOMPurify's own attribute
 * sanitation runs. An image whose src the current resolver maps to a relay
 * URL survives with EXACTLY that src (the raw value is discarded) plus
 * `loading="lazy"`; anything else — no resolver, cross-host, data:/blob:,
 * unparseable — is replaced by an inert `[figure]` placeholder span so a
 * dropped image leaves a visible trace instead of disappearing silently.
 * Registered exactly once per module load (DOMPurify's hook list is a
 * singleton on the default export) — calling `sanitizePaperHtml` repeatedly
 * must never accumulate duplicate hooks.
 */
function ensureImgHook(): void {
  if (hookRegistered) return
  hookRegistered = true
  DOMPurify.addHook("uponSanitizeElement", (node) => {
    const element = node as unknown as Element
    if (element.nodeType !== 1) return
    if (element.tagName?.toLowerCase() !== "img") return

    const rawSrc = element.getAttribute("src") ?? ""
    const resolved = currentResolveImageSrc ? currentResolveImageSrc(rawSrc) : null
    if (resolved) {
      element.setAttribute("src", resolved)
      element.setAttribute("loading", "lazy")
      return
    }

    const placeholder = element.ownerDocument.createElement("span")
    placeholder.textContent = FIGURE_PLACEHOLDER_TEXT
    placeholder.setAttribute("class", "reader-figure-placeholder")
    element.parentNode?.replaceChild(placeholder, element)
  })
}

/**
 * Sanitizes `html` down to a safe structural subset for the in-app reader.
 * Deterministic: the same `html` + the same (pure) `resolveImageSrc` always
 * yield the same output; DOMPurify's own config is fixed here, not
 * caller-tunable beyond the image resolver.
 */
export function sanitizePaperHtml(html: string, options: SanitizePaperHtmlOptions = {}): string {
  ensureImgHook()
  currentResolveImageSrc = options.resolveImageSrc ?? null
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS,
      FORBID_ATTR,
      FORBID_CONTENTS,
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    })
  } finally {
    currentResolveImageSrc = null
  }
}
