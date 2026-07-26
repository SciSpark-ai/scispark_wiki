import type { Bundle } from "../vault/bundle"
import { significantTokens } from "../trending/lens"
import { MAX_SELECTED_PAGES } from "./select-pages"

// Mirrors the split boundary in `trending/lens.ts`'s private TOKEN_SPLIT_RE
// (lowercase, split on any run of non-alphanumeric characters). Duplicated
// here only for extracting SHORT words the shared tokenizer discards — see
// `shortWordsIn` below — not forked as a second "significant token"
// definition; `significantTokens` itself is still imported and used as-is.
const WORD_SPLIT_RE = /[^a-z0-9]+/

// Mirrors `trending/lens.ts`'s private MIN_TOKEN_LENGTH (4). A word shorter
// than this is dropped by significantTokens purely for length — none of
// lens.ts's STOPWORDS entries are this short, so length alone identifies
// these words without needing access to the stopword set.
const MIN_SIGNIFICANT_LENGTH = 4

/**
 * Words the shared tokenizer discards purely for being too short (e.g. "eeg",
 * "trf", "erp") — domain acronyms that are exactly the kind of short, curated
 * term a page's `tags` (not its free-text title/body) are likely to carry
 * verbatim.
 */
function shortWordsIn(text: string): Set<string> {
  const words = text.toLowerCase().split(WORD_SPLIT_RE)
  const result = new Set<string>()
  for (const word of words) {
    if (word.length === 0) continue
    if (word.length >= MIN_SIGNIFICANT_LENGTH) continue
    result.add(word)
  }
  return result
}

/**
 * The deterministic degradation path for KB chat's page-selection step
 * (`src/lib/chat/select-pages.ts`, Task 3): when the cheap LLM call that
 * normally narrows the wiki index down to a handful of relevant pages fails
 * (provider outage, budget exhausted, structured-output rejection), the
 * orchestrator (Task 6) falls back to this pure term-overlap scorer instead
 * of failing the whole chat turn.
 *
 * Scores each page by how many significant tokens (see `significantTokens`
 * in `trending/lens.ts` — the one shared tokenizer definition in this
 * codebase) its title + tags share with the question, PLUS one point per
 * short question word (below the tokenizer's length floor, e.g. a domain
 * acronym like "eeg") that exactly matches one of the page's tags verbatim.
 * The short-word path is deliberately tag-only, never title/body — tags are
 * curated and low-noise, so exact equality there is safe in a way that
 * matching short strings against free text would not be (a 3-letter word
 * turns up as a substring constantly). Drops pages that score nothing, and
 * returns page ids sorted by score descending, then id ascending for
 * stability, capped at `limit`.
 */
export function fallbackSelectPages(
  bundle: Bundle,
  question: string,
  limit: number = MAX_SELECTED_PAGES,
): string[] {
  const questionTokens = significantTokens(question)
  const shortQuestionWords = shortWordsIn(question)
  if (questionTokens.size === 0 && shortQuestionWords.size === 0) return []

  const scored: Array<{ id: string; score: number }> = []
  for (const page of bundle.pages.values()) {
    const tags = page.frontmatter.tags ?? []
    const pageTokens = significantTokens(page.frontmatter.title)
    for (const tag of tags) {
      for (const token of significantTokens(tag)) pageTokens.add(token)
    }

    let score = 0
    for (const token of questionTokens) {
      if (pageTokens.has(token)) score++
    }

    if (shortQuestionWords.size > 0 && tags.length > 0) {
      const lowerTags = new Set(tags.map((tag) => tag.toLowerCase()))
      for (const word of shortQuestionWords) {
        if (lowerTags.has(word)) score++
      }
    }

    if (score > 0) scored.push({ id: page.id, score })
  }

  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return scored.slice(0, limit).map((entry) => entry.id)
}
