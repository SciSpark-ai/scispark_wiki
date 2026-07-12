// Matches a closed fence (```...```) OR an unterminated fence that runs to
// end-of-string (```... with no closing ```), so a stray/mid-edit opening
// fence still masks everything after it instead of leaking wikilinks.
const FENCE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g

export function extractWikilinks(body: string): string[] {
  const masked = body.replace(FENCE_RE, "").replace(INLINE_CODE_RE, "")
  const out: string[] = []
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const slug = m[1].trim()
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}
