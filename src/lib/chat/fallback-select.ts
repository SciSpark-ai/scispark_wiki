import type { Bundle } from "../vault/bundle"
import { significantTokens } from "../trending/lens"
import { MAX_SELECTED_PAGES } from "./select-pages"

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
 * codebase) its title + tags share with the question, drops pages that
 * share nothing, and returns page ids sorted by score descending, then id
 * ascending for stability, capped at `limit`.
 */
export function fallbackSelectPages(
  bundle: Bundle,
  question: string,
  limit: number = MAX_SELECTED_PAGES,
): string[] {
  const questionTokens = significantTokens(question)
  if (questionTokens.size === 0) return []

  const scored: Array<{ id: string; score: number }> = []
  for (const page of bundle.pages.values()) {
    const pageTokens = significantTokens(page.frontmatter.title)
    for (const tag of page.frontmatter.tags ?? []) {
      for (const token of significantTokens(tag)) pageTokens.add(token)
    }

    let score = 0
    for (const token of questionTokens) {
      if (pageTokens.has(token)) score++
    }
    if (score > 0) scored.push({ id: page.id, score })
  }

  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return scored.slice(0, limit).map((entry) => entry.id)
}
