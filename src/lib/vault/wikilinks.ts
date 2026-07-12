const FENCE_RE = /```[\s\S]*?```/g
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
