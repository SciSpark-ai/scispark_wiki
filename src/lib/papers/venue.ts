import { displayTitle } from "./title"

/**
 * Trailing parenthetical that names the PUBLISHER rather than the venue —
 * OpenAlex ships preprint servers this way ("bioRxiv (Cold Spring Harbor
 * Laboratory)", "SSRN (Elsevier)"). In a card's one-line footer the suffix
 * is pure noise and pushes the actual venue name out of the visible width,
 * which is how Tong saw it: "bioRxiv (Cold Spring Harbo…" (2026-07-19).
 *
 * Only stripped when something is left over, so a venue that is ENTIRELY
 * parenthesised keeps its text instead of collapsing to nothing.
 */
const TRAILING_PARENTHETICAL = /\s*\([^()]*\)\s*$/

/**
 * Display form of a venue string: markup/entities decoded (same treatment
 * every other visible title gets) and the publisher parenthetical dropped.
 * Returns undefined for missing/blank input so callers can omit the field
 * entirely rather than printing a placeholder.
 */
export function displayVenue(venue: string | undefined | null): string | undefined {
  if (venue == null) return undefined
  const cleaned = displayTitle(venue)
  if (cleaned === "") return undefined
  const stripped = cleaned.replace(TRAILING_PARENTHETICAL, "").trim()
  return stripped === "" ? cleaned : stripped
}

/**
 * The "venue · year" line shared by the feed card and the paper header.
 * Missing parts are omitted rather than rendered as placeholders — the feed
 * card used to print a literal "no venue · 2026", which reads like a data
 * error to the user. Returns undefined when nothing is known at all.
 */
export function venueYearLine(venue: string | undefined | null, year: number | undefined | null): string | undefined {
  const parts = [displayVenue(venue), year != null ? String(year) : undefined].filter(
    (v): v is string => Boolean(v),
  )
  return parts.length > 0 ? parts.join(" · ") : undefined
}
