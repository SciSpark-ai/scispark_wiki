import type { HighlightAnchor } from "./types"

/** Default characters of surrounding context captured on each side of a
 * highlighted quote (see M6 plan Task 2). */
export const CONTEXT_LEN = 32

/**
 * Builds a quote+context+position anchor for `text.slice(start, end)`.
 * `prefix`/`suffix` capture up to `contextLen` characters immediately
 * before/after the quote (clamped to the string bounds); `start`/`end` are
 * carried as a position hint for resolveAnchor's fast path.
 *
 * Throws on `start >= end` or an out-of-range `[start, end)` — both are
 * caller bugs (e.g. a collapsed or malformed selection), never a runtime
 * "orphaned" state (that's resolveAnchor's job once text has re-rendered).
 */
export function createAnchor(text: string, start: number, end: number, contextLen: number = CONTEXT_LEN): HighlightAnchor {
  if (start >= end) {
    throw new Error(`createAnchor: start (${start}) must be < end (${end})`)
  }
  if (start < 0 || end > text.length) {
    throw new Error(`createAnchor: range [${start}, ${end}) is out of bounds for text of length ${text.length}`)
  }

  const exact = text.slice(start, end)
  const prefix = text.slice(Math.max(0, start - contextLen), start)
  const suffix = text.slice(end, Math.min(text.length, end + contextLen))

  return { exact, prefix, suffix, start, end }
}

/** Every index at which `needle` occurs in `haystack`, found via a plain
 * indexOf loop (never a RegExp) so a needle containing regex metacharacters
 * — `.*[](){}` etc. — is matched literally. Returns [] for an empty needle
 * (an anchor with an empty `exact` can never be meaningfully resolved). */
function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return []
  const indices: number[] = []
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    indices.push(idx)
    idx = haystack.indexOf(needle, idx + 1)
  }
  return indices
}

/** Length of the longest common suffix of `a` and `b`. */
function longestCommonSuffixLength(a: string, b: string): number {
  let i = a.length - 1
  let j = b.length - 1
  let count = 0
  while (i >= 0 && j >= 0 && a[i] === b[j]) {
    i -= 1
    j -= 1
    count += 1
  }
  return count
}

/** Length of the longest common prefix of `a` and `b`. */
function longestCommonPrefixLength(a: string, b: string): number {
  let i = 0
  const max = Math.min(a.length, b.length)
  while (i < max && a[i] === b[i]) {
    i += 1
  }
  return i
}

/**
 * Resolves a stored anchor against the (possibly re-rendered) `text`,
 * deterministically and DOM-free. Three tiers:
 *
 * 1. Fast path — `anchor.start`/`end` still point at `anchor.exact`: return
 *    them unchanged (the common case; text hasn't shifted).
 * 2. Context search — `anchor.exact` occurs elsewhere. Find every
 *    occurrence via indexOf (never RegExp, so `exact` containing regex
 *    metacharacters is matched literally), score each by how much of
 *    `anchor.prefix`/`anchor.suffix` it recovers, and take the
 *    highest-scoring occurrence (ties broken by proximity to the original
 *    `anchor.start`).
 * 3. Orphaned — `anchor.exact` occurs nowhere in `text`: return `null`.
 *    This is a first-class state, never a thrown error.
 */
export function resolveAnchor(text: string, anchor: HighlightAnchor): { start: number; end: number } | null {
  const { exact, prefix, suffix, start, end } = anchor

  // Tier 1: fast path.
  if (start >= 0 && start <= end && end <= text.length && text.slice(start, end) === exact) {
    return { start, end }
  }

  // Tier 2: context search over every occurrence of `exact`.
  const occurrences = findAllOccurrences(text, exact)
  if (occurrences.length === 0) {
    // Tier 3: orphaned.
    return null
  }

  let bestIndex = occurrences[0]
  let bestScore = -1
  let bestDistance = Infinity

  for (const i of occurrences) {
    const textBefore = text.slice(0, i)
    const textAfter = text.slice(i + exact.length)
    const score = longestCommonSuffixLength(textBefore, prefix) + longestCommonPrefixLength(textAfter, suffix)
    const distance = Math.abs(i - start)

    const isBetter = score > bestScore || (score === bestScore && distance < bestDistance)
    if (isBetter) {
      bestIndex = i
      bestScore = score
      bestDistance = distance
    }
  }

  return { start: bestIndex, end: bestIndex + exact.length }
}
