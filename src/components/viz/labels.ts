const MAX_GRAPH_LABEL = 42

/**
 * Truncates a graph node label to MAX_GRAPH_LABEL at a word boundary, so
 * long titles display cleanly without overlapping on the canvas. Pure.
 */
export function truncateGraphLabel(title: string, max: number = MAX_GRAPH_LABEL): string {
  if (title.length <= max) return title
  const cut = title.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

// Base threshold at the camera's default ratio (1). Sits above MIN_NODE_SIZE
// (4, see graph-style.ts) so small isolated-node labels stay hidden at rest,
// and below MAX_NODE_SIZE (16) so hub nodes always label.
const BASE_LABEL_THRESHOLD = 7

/**
 * Sigma's `labelRenderedSizeThreshold` setting is compared against a node's
 * ALREADY zoom-scaled on-screen size: Sigma's `scaleSize()` divides a
 * node's raw `size` by `zoomToSizeRatioFunction(cameraRatio)` (default
 * `Math.sqrt`, given the default `itemSizesReference: "screen"` — see
 * node_modules/sigma/settings/dist/sigma-settings.esm.js DEFAULT_SETTINGS
 * and dist/sigma.esm.js's `scaleSize`/label-rendering pass) before the
 * comparison. That means a single STATIC threshold already makes
 * small-node labels reveal progressively as the camera zooms in (smaller
 * `ratio` → larger scaled size) — no per-frame setting update is needed.
 *
 * This helper computes that one static threshold from the camera's
 * ratio at setup time (always 1 for a freshly constructed Sigma instance)
 * rather than hardcoding a magic number, so the reasoning stays
 * inspectable and testable independent of Sigma/WebGL.
 */
export function labelThresholdForRatio(ratio: number): number {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return BASE_LABEL_THRESHOLD * Math.sqrt(safeRatio)
}
