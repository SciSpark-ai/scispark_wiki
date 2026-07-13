// Pure text-mapping helpers for the PDF reading surface (M6 Task 6).
//
// Deliberately free of any pdfjs-dist import: pdf.js touches
// DOMMatrix/canvas and must never load outside the browser, but this module
// stays plain data-in/data-out so it runs in the node vitest environment
// without a DOM.

/**
 * Joins one page's pdf.js text-content items into a single plain-text
 * string, separated by a single space (mirroring `Array.prototype.join(" ")`
 * over each item's `str`). Also returns the start offset of every item
 * within the joined string, so a later DOM selection inside that item's
 * rendered span can be mapped back to a position in the plain-text surface.
 *
 * Deterministic and pure: the same `items` always produce the same
 * `{text, itemOffsets}`. An empty `items` array returns
 * `{text: "", itemOffsets: []}`.
 */
export function joinPageText(items: Array<{ str: string }>): { text: string; itemOffsets: number[] } {
  const itemOffsets: number[] = []
  let text = ""

  for (let i = 0; i < items.length; i += 1) {
    itemOffsets.push(text.length)
    text += items[i].str
    if (i < items.length - 1) {
      text += " "
    }
  }

  return { text, itemOffsets }
}
