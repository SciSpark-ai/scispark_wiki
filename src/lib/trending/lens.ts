import type { Bundle } from "../vault/bundle"
import type { PaperRecord } from "../papers/types"
import { findPaperPage } from "../papers/page-state"
import { paperSlug } from "../wiki/authoring"

export interface TopicLensResult {
  relevant: boolean
  /** Wiki page ids for those representative papers that already exist in the vault. */
  wikiPageIds: string[]
}

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
 * any tag on any page already in the wiki. Separately, resolves the topic's
 * representative papers against the vault (via `findPaperPage`/`paperSlug`)
 * to surface links into existing wiki pages. Produces NO counts — the UI
 * renders links, or nothing, from `wikiPageIds`.
 */
export function topicLens(
  topic: { label: string; papers: PaperRecord[] },
  interestLabels: string[],
  bundle: Bundle,
): TopicLensResult {
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

  const seen = new Set<string>()
  const wikiPageIds: string[] = []
  for (const paper of topic.papers) {
    const page = findPaperPage(bundle, paperSlug(paper))
    if (page && !seen.has(page.id)) {
      seen.add(page.id)
      wikiPageIds.push(page.id)
    }
  }

  return { relevant, wikiPageIds }
}
