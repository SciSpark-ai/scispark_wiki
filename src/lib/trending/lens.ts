import type { Bundle } from "../vault/bundle"

const MIN_TOKEN_LENGTH = 4
const STOPWORDS = new Set([
  "with",
  "from",
  "using",
  "based",
  "data",
  "model",
  "models",
  "analysis",
  "study",
])
const TOKEN_SPLIT_RE = /[^a-z0-9]+/

/**
 * Lowercases, splits on any run of non-alphanumeric characters, and drops
 * tokens shorter than MIN_TOKEN_LENGTH or in the stopword set — deterministic,
 * no locale/unicode-awareness beyond ASCII case folding.
 */
function significantTokens(text: string): Set<string> {
  const tokens = text.toLowerCase().split(TOKEN_SPLIT_RE)
  const result = new Set<string>()
  for (const token of tokens) {
    if (token.length < MIN_TOKEN_LENGTH) continue
    if (STOPWORDS.has(token)) continue
    result.add(token)
  }
  return result
}

function sharesSignificantToken(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) {
    if (b.has(token)) return true
  }
  return false
}

/**
 * The relevance lens for SP4's trending leaderboard: a topic is "relevant to
 * you" when its label shares a significant term (deterministic tokenizer,
 * see `significantTokens`) with any of the user's interest labels, or with
 * any tag on any page already in the wiki. Produces NO counts and no scores —
 * a single boolean, which is all the UI's "relevant to you" marker needs.
 *
 * It deliberately does NOT resolve the topic's representative papers to wiki
 * pages: that link is per-PAPER (`BoardPaper.wikiPageId`, resolved in
 * dashboard.ts, which is what the UI actually renders), and this module used to
 * compute a parallel per-topic `wikiPageIds` list that every caller discarded.
 */
export function topicLens(
  topic: { label: string },
  interestLabels: string[],
  bundle: Bundle,
): { relevant: boolean } {
  const topicTokens = significantTokens(topic.label)

  let relevant = false
  if (topicTokens.size > 0) {
    for (const interestLabel of interestLabels) {
      if (sharesSignificantToken(topicTokens, significantTokens(interestLabel))) {
        relevant = true
        break
      }
    }
    if (!relevant) {
      for (const page of bundle.pages.values()) {
        const tags = page.frontmatter.tags ?? []
        let matched = false
        for (const tag of tags) {
          if (sharesSignificantToken(topicTokens, significantTokens(tag))) {
            matched = true
            break
          }
        }
        if (matched) {
          relevant = true
          break
        }
      }
    }
  }

  return { relevant }
}
