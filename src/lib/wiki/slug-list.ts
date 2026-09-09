import { slugifyTitle } from "./authoring"

export function sanitizeSlugList(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const lastSegment = value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value
    const slug = slugifyTitle(lastSegment)
    // slugifyTitle falls back to "untitled" when a value has no usable slug characters
    // (empty or punctuation-only) — drop those instead of tagging pages "untitled".
    if (slug === "untitled" && lastSegment.trim().toLowerCase() !== "untitled") continue
    if (seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}
