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
