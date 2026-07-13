/**
 * Bridges the flat plain-text offset space the anchor core operates in
 * (`src/lib/highlights/anchor.ts` — pure strings, no DOM) and live DOM
 * `Range`s (what browser selection and highlight painting use). Every
 * function here is correctness-critical: an off-by-one turns into a
 * mis-painted highlight or a selection that quotes the wrong passage.
 *
 * The implementation leans on the DOM's own `Range.toString()` /
 * `Range.setStart`/`setEnd` rather than hand-rolled tree-walking arithmetic
 * wherever possible, since those are exactly the primitives the spec
 * guarantees behave consistently with `Node.textContent` (both are
 * "concatenate Text node data in tree order" operations) — see
 * `offsetOfPoint` below.
 */

/** The flat plain-text this container's offsets are measured against.
 * Equal to `root.textContent`, kept as a named export so callers never have
 * to remember which of `.textContent` vs. `.innerText` is the right one
 * (`.innerText` depends on layout and doesn't exist in jsdom). */
export function plainTextOf(root: Node): string {
  return root.textContent ?? ""
}

/**
 * Converts a DOM point `(container, offset)` — the same addressing scheme
 * `Range.setStart`/`setEnd` and `Selection` boundary points use — into an
 * index into `plainTextOf(root)`, by measuring the length of a scratch
 * range spanning from the very start of `root` up to that point. This is
 * exactly the flattening `plainTextOf`/`textContent` performs, so the
 * result is always a valid index into that same string.
 *
 * Returns `null` if `container`/`offset` isn't a valid boundary point
 * relative to `root` (e.g. belongs to a different document) rather than
 * throwing.
 */
function offsetOfPoint(root: Node, container: Node, offset: number): number | null {
  try {
    const scratch = new Range()
    scratch.setStart(root, 0)
    scratch.setEnd(container, offset)
    return scratch.toString().length
  } catch {
    return null
  }
}

/**
 * Converts a live selection `Range` inside `root` into `{start, end}`
 * offsets in `plainTextOf(root)`'s flat text space.
 *
 * Returns `null` for a collapsed range (nothing selected) or when either
 * boundary point can't be resolved against `root`. `start`/`end` are always
 * returned in text order (`start <= end`) regardless of which direction the
 * user dragged the selection (`Range`'s own start/end are already
 * document-order, not drag-order, so this mirrors that).
 */
export function rangeToOffsets(root: Node, range: Range): { start: number; end: number } | null {
  if (range.collapsed) return null

  const start = offsetOfPoint(root, range.startContainer, range.startOffset)
  const end = offsetOfPoint(root, range.endContainer, range.endOffset)
  if (start === null || end === null) return null
  if (start === end) return null

  return start < end ? { start, end } : { start: end, end: start }
}

/**
 * Locates the DOM point (a `Text` node + a character offset into it)
 * corresponding to `targetOffset` in `plainTextOf(root)`, by walking
 * `root`'s text nodes in tree order and accumulating their lengths — the
 * inverse of the flattening `plainTextOf` performs.
 *
 * Returns `null` when `targetOffset` is negative or falls beyond the end of
 * `root`'s text (including when `root` has no text nodes at all).
 */
function pointAtOffset(root: Node, targetOffset: number): { node: Text; offset: number } | null {
  if (targetOffset < 0) return null

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let node = walker.nextNode() as Text | null

  while (node !== null) {
    const length = node.data.length
    if (targetOffset <= consumed + length) {
      return { node, offset: targetOffset - consumed }
    }
    consumed += length
    node = walker.nextNode() as Text | null
  }

  return null
}

/**
 * Builds a live DOM `Range` inside `root` spanning `plainTextOf(root)`'s
 * `[start, end)` — the inverse of `rangeToOffsets`. Used both to paint
 * highlights (`HighlightLayer`) and to re-derive a selection rect after the
 * anchor core resolves a stored highlight's offsets.
 *
 * Returns `null` when the range would be empty or collapsed (`start >=
 * end`) or when either endpoint falls outside `root`'s actual text (e.g. a
 * stale offset from before the surface's content changed) — callers must
 * treat that as "can't paint this," never crash.
 */
export function offsetsToRange(root: Node, start: number, end: number): Range | null {
  if (start >= end) return null

  const startPoint = pointAtOffset(root, start)
  const endPoint = pointAtOffset(root, end)
  if (startPoint === null || endPoint === null) return null

  const range = new Range()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}
