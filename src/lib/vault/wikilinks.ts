// Matches a closed fence (```...```) OR an unterminated fence that runs to
// end-of-string (```... with no closing ```), so a stray/mid-edit opening
// fence still masks everything after it instead of leaking wikilinks.
const FENCE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`[^`\n]*`/g
// Group 1 = slug (untrimmed), group 2 = alias text (untrimmed, only present
// for piped links) — kept as two capture groups so callers needing the alias
// (e.g. lint's broken-link neutralization) don't need a second regex.
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g

/**
 * Replaces every fenced/inline code span with same-length whitespace,
 * preserving every other character and its offset. Unlike a plain
 * `.replace(re, "")`, this keeps positions in the masked string aligned with
 * `body`, so match indices found against the masked string can be used
 * directly to slice/splice `body` itself.
 */
function maskCodeSpans(body: string): string {
  return body
    .replace(FENCE_RE, (m) => " ".repeat(m.length))
    .replace(INLINE_CODE_RE, (m) => " ".repeat(m.length))
}

export interface WikilinkMatch {
  slug: string
  /** Alias text (trimmed), if this is a piped `[[slug|alias]]` link with a
   * non-blank alias. `undefined` for bare links or a blank/whitespace alias. */
  alias?: string
  /** Character offsets into the ORIGINAL `body` passed to
   * `findWikilinkMatches` (not the masked copy) — safe to use for slicing. */
  start: number
  end: number
}

/**
 * Finds every real wikilink occurrence in `body` — i.e. every `[[slug]]` /
 * `[[slug|alias]]` NOT inside a fenced or inline code span — in document
 * order, with character offsets into the original `body`. This is the single
 * source of truth for "what counts as a real wikilink"; `extractWikilinks`
 * and any position-based rewrite (e.g. lint's broken-link fix) should build
 * on this rather than re-deriving their own masking.
 */
export function findWikilinkMatches(body: string): WikilinkMatch[] {
  const masked = maskCodeSpans(body)
  const out: WikilinkMatch[] = []
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const slug = m[1].trim()
    if (!slug) continue
    const aliasRaw = m[2]
    const alias = aliasRaw !== undefined && aliasRaw.trim() ? aliasRaw.trim() : undefined
    out.push({ slug, alias, start: m.index, end: m.index + m[0].length })
  }
  return out
}

export function extractWikilinks(body: string): string[] {
  const out: string[] = []
  for (const { slug } of findWikilinkMatches(body)) {
    if (!out.includes(slug)) out.push(slug)
  }
  return out
}
