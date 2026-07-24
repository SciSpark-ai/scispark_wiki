// Pure graph-styling helpers for GraphView (node sizing, community→color
// mapping). Deliberately has NO import of sigma/graphology — those touch
// WebGL/canvas at import time (see GraphView.tsx's top-of-file comment) and
// this module must stay importable from plain jsdom tests.

export const MIN_NODE_SIZE = 4
export const MAX_NODE_SIZE = 16

/**
 * Continuous degree-based node sizing: `min + (max-min) * sqrt(degree/maxDegree)`.
 * The sqrt compresses the range so a handful of hub nodes don't dwarf
 * everything else while still visually separating a degree-1 node from a
 * degree-20 one. Boundary-safe: a graph with no edges at all (`maxDegree`
 * 0) and an isolated node (`degree` 0) both settle at `MIN_NODE_SIZE`
 * instead of producing `NaN` from a 0/0 division.
 */
export function nodeSize(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return MIN_NODE_SIZE
  const safeDegree = Math.min(Math.max(0, degree), maxDegree)
  const t = Math.sqrt(safeDegree / maxDegree)
  return MIN_NODE_SIZE + (MAX_NODE_SIZE - MIN_NODE_SIZE) * t
}

/** Number of categorical community colors defined in globals.css
 * (`--viz-cat-1` … `--viz-cat-8`). */
export const VIZ_CAT_COUNT = 8

/**
 * Fallback categorical palette used when CSS custom properties aren't
 * available (non-browser/test contexts) or a `--viz-cat-N` value is unset.
 * Mirrors the light-theme `--viz-cat-1`…`--viz-cat-8` values in
 * src/app/globals.css — keep the two in sync if either changes.
 */
export const FALLBACK_COMMUNITY_PALETTE: string[] = [
  "#f97316", // orange (brand)
  "#0d9488", // teal
  "#8b5cf6", // violet
  "#16a34a", // green
  "#4f46e5", // indigo
  "#a16207", // olive gold
  "#0891b2", // cyan
  "#db2777", // pink
]

/**
 * Maps a Louvain community index onto one of the 8 `--viz-cat-N` CSS
 * custom property names, wrapping (mod `VIZ_CAT_COUNT`) so any community
 * count is covered — community 8 maps back to `--viz-cat-1`, 9 to
 * `--viz-cat-2`, and so on.
 */
export function communityColorVarName(community: number): string {
  const idx = ((community % VIZ_CAT_COUNT) + VIZ_CAT_COUNT) % VIZ_CAT_COUNT
  return `--viz-cat-${idx + 1}`
}

/**
 * Resolves a community index to a concrete color string from a given
 * palette (either the live CSS-var-derived palette or
 * `FALLBACK_COMMUNITY_PALETTE`), wrapping on the palette's own length so it
 * stays correct regardless of how many colors were actually resolved.
 */
export function communityColor(community: number, palette: string[]): string {
  if (palette.length === 0) return FALLBACK_COMMUNITY_PALETTE[0]
  const idx = ((community % palette.length) + palette.length) % palette.length
  return palette[idx]
}
