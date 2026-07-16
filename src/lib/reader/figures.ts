import { relayUrl } from "../wiki/acquire"

/**
 * Figure-URL resolution for the in-app reader: turns the `<img src>` values
 * found in untrusted paper HTML into `/api/fetch` relay URLs the sanitizer
 * can safely keep, or `null` for anything that must stay a `[figure]`
 * placeholder.
 *
 * Security rules (each one a boundary):
 *  - only http(s) srcs resolve at all — `data:`/`blob:`/`javascript:` etc.
 *    are rejected outright;
 *  - the resolved URL must be https (the relay is https-only, modulo its own
 *    single documented arXiv-export exception which never serves images);
 *  - the resolved host must EQUAL the paper's own host — crafted paper HTML
 *    must not be able to turn every reader into an arbitrary-URL fetcher via
 *    our relay (the relay's host allowlist is the second line of defense).
 */

/** Reads the document's `<base href="…">` from RAW paper HTML (the sanitizer
 * drops `<head>` content, so this must run before sanitization). Uses a
 * scratch DOMParser document — never executes anything. */
export function extractBaseHref(html: string): string | null {
  // DOMParser is available in every context this runs in (browser client
  // component; jsdom in tests). Parsing never runs scripts or loads
  // subresources for text/html documents created this way.
  const doc = new DOMParser().parseFromString(html, "text/html")
  const base = doc.querySelector("base[href]")
  const href = base?.getAttribute("href")?.trim()
  return href && href.length > 0 ? href : null
}

/**
 * Builds the src-resolver `sanitizePaperHtml` consumes: raw img src →
 * relayed URL string, or null → placeholder. `sourceUrl` is the URL the
 * paper HTML was originally fetched from (`ReaderContent.sourceUrl`,
 * `paper.htmlUrl`, or an arXiv-id-derived fallback); without one, nothing
 * resolves (every figure stays a placeholder).
 */
export function buildFigureSrcResolver(
  documentHtml: string,
  sourceUrl: string | undefined,
  apiBase = "",
): (rawSrc: string) => string | null {
  let base: URL | null = null
  if (sourceUrl) {
    try {
      const origin = new URL(sourceUrl)
      const baseHref = extractBaseHref(documentHtml)
      // A path-absolute base ("/html/2409.08710v1/") resolves against the
      // source origin; an absolute base URL stands alone; no base tag means
      // the source URL itself is the base — exactly the browser's own rules.
      base = baseHref ? new URL(baseHref, origin) : origin
    } catch {
      base = null
    }
  }

  return (rawSrc: string): string | null => {
    if (!base) return null
    const src = rawSrc.trim()
    if (src.length === 0) return null
    // Explicit scheme check before URL resolution: data:/blob:/javascript:
    // parse fine as URLs but must never reach the relay.
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^https?:/i.test(src)) return null

    let resolved: URL
    try {
      resolved = new URL(src, base)
    } catch {
      return null
    }

    if (resolved.protocol !== "https:") return null
    if (resolved.hostname !== base.hostname) return null
    if (resolved.username || resolved.password) return null

    return relayUrl(apiBase, resolved.toString())
  }
}
