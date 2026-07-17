export interface TrackedField {
  /** URL/id-safe slug derived from the label. */
  slug: string
  /** Human-readable research-area name, as the user wrote it in interests.md. */
  label: string
}

export const MAX_TRACKED_FIELDS = 3

/**
 * Upper bound on a tracked field's label length. Free-text onboarding answers
 * can be arbitrarily long; a field label doubles as an OpenAlex query, so keep
 * it short enough to match real works instead of a whole sentence.
 */
export const MAX_FIELD_LABEL_LEN = 60

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Splits free-text topic input (a bullet, an onboarding answer) into discrete
 * topic labels. Splits on newlines, commas, and semicolons; trims; strips a
 * leading list conjunction ("and X"); drops blanks; dedups by slug. Preserves
 * the user's wording (no truncation) — callers that need short labels truncate
 * separately. Pure.
 */
export function splitTopics(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[\n,;]+/)) {
    const label = piece.trim().replace(/^and\s+/i, "").trim()
    if (label.length === 0) continue
    const slug = slugify(label)
    if (slug.length === 0 || seen.has(slug)) continue
    seen.add(slug)
    out.push(label)
  }
  return out
}

/**
 * Truncates a topic label to MAX_FIELD_LABEL_LEN at a word boundary, so an
 * over-long single clause still yields a clean, queryable field label.
 * Strips dangling unclosed parens (C9) and marks truncation with ellipsis. Pure.
 */
export function truncateFieldLabel(label: string): string {
  if (label.length <= MAX_FIELD_LABEL_LEN) return label
  const cut = label.slice(0, MAX_FIELD_LABEL_LEN)
  const lastSpace = cut.lastIndexOf(" ")
  let result = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()
  // Strip dangling open-paren fragment (C9)
  result = result.replace(/\s*\([^)]*$/, "")
  // Mark truncation with ellipsis (append only if result is shorter than input)
  if (result.length < label.length) result += "…"
  return result
}

/**
 * Parses the `## Active topics` section of interests.md into up to
 * MAX_TRACKED_FIELDS research-area fields. Only that section is read (Rising/
 * Fading are momentum notes, not tracked fields). Each bullet is split on
 * commas/semicolons into discrete topics (so a single free-text onboarding
 * answer stored as one bullet yields distinct fields, not one giant slug), then
 * truncated to a clean short label and deduped by slug. Returns [] when the
 * section is absent or empty. Pure.
 */
export function deriveTrackedFields(interestsMarkdown: string | null): TrackedField[] {
  if (!interestsMarkdown) return []
  const lines = interestsMarkdown.split("\n")
  const start = lines.findIndex((l) => /^##\s+Active topics\s*$/i.test(l.trim()))
  if (start === -1) return []

  const bullets: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith("## ")) break // next section
    const m = line.match(/^-\s+(.*\S)\s*$/)
    if (!m) continue
    bullets.push(m[1].trim())
  }

  const fields: TrackedField[] = []
  const seen = new Set<string>()
  for (const topic of splitTopics(bullets.join("\n"))) {
    const label = truncateFieldLabel(topic)
    const slug = slugify(label)
    if (slug.length === 0 || seen.has(slug)) continue
    seen.add(slug)
    fields.push({ slug, label })
    if (fields.length >= MAX_TRACKED_FIELDS) break
  }
  return fields
}

/**
 * The fields actually tracked: explicit settings win when non-empty,
 * otherwise fall back to deriving fields from interests.md's Active topics
 * section. Centralizes the `settingsFields.length > 0 ? settingsFields :
 * deriveTrackedFields(interestsMarkdown)` fallback repeated across
 * /profile, /trending, and the auto-refresh cron. Pure.
 */
export function effectiveTrackedFields(
  settingsFields: TrackedField[],
  interestsMarkdown: string | null,
): TrackedField[] {
  return settingsFields.length > 0 ? settingsFields : deriveTrackedFields(interestsMarkdown)
}
