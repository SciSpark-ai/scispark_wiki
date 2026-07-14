export interface TrackedField {
  /** URL/id-safe slug derived from the label. */
  slug: string
  /** Human-readable research-area name, as the user wrote it in interests.md. */
  label: string
}

export const MAX_TRACKED_FIELDS = 3

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Parses the `## Active topics` section of interests.md into up to
 * MAX_TRACKED_FIELDS research-area fields. Only that section is read (Rising/
 * Fading are momentum notes, not tracked fields). Returns [] when the section
 * is absent or empty. Pure.
 */
export function deriveTrackedFields(interestsMarkdown: string | null): TrackedField[] {
  if (!interestsMarkdown) return []
  const lines = interestsMarkdown.split("\n")
  const start = lines.findIndex((l) => /^##\s+Active topics\s*$/i.test(l.trim()))
  if (start === -1) return []

  const fields: TrackedField[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith("## ")) break // next section
    const m = line.match(/^-\s+(.*\S)\s*$/)
    if (!m) continue
    const label = m[1].trim()
    const slug = slugify(label)
    if (slug.length === 0) continue
    fields.push({ slug, label })
    if (fields.length >= MAX_TRACKED_FIELDS) break
  }
  return fields
}
