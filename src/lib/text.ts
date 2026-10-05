/** Lower-cased alphanumeric tokens of at least `minLength` chars, for term-overlap scoring. */
export function tokenize(text: string, minLength = 4): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= minLength))
}

/** Cuts `text` to at most `limit` chars, backing up to the last whitespace within 200 chars of the cut. */
export function truncateAtWhitespace(text: string, limit: number): string {
  if (text.length <= limit) return text
  const hardCut = text.slice(0, limit)
  const searchFloor = Math.max(0, hardCut.length - 200)
  for (let i = hardCut.length - 1; i >= searchFloor; i--) {
    if (/\s/.test(hardCut[i])) return hardCut.slice(0, i)
  }
  return hardCut
}
