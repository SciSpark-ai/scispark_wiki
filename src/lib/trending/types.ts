// Shared data contract only; this module must not import runtime orchestration.
import type { PaperRecord } from "../papers/types"
import type { AnchorDiscipline } from "./anchors"

export interface BoardPaper {
  record: PaperRecord
  /** Wiki page id when this paper already exists in the vault; null otherwise. Never a count — the KB connection is a link or nothing (SP4 §4). */
  wikiPageId: string | null
}

export interface BoardTopic {
  key: string
  label: string
  /** The anchor discipline this topic was ranked within (an `AnchorDiscipline.label`). */
  discipline: string
  /**
   * Change in the topic's SHARE of its discipline: (recentShare − priorShare) /
   * priorShare. Null when the prior count is too small to divide by (zero, or
   * under `MIN_PRIOR_COUNT`) — rendered as "new", never ∞.
   * Share-based because OpenAlex's indexing lag shrinks the recent window's
   * corpus for every topic alike, which raw counts would read as a board-wide
   * decline (see `rankHeatingTopics` for the measured figures).
   */
  growth: number | null
  recentCount: number
  /**
   * The topic's TRUE prior-window count (`lookupPriorCounts`). Kept alongside
   * `recentCount` as honest ABSOLUTE volume — rendered as text on the expanded
   * row, never drawn to scale (bars are share-scaled, below).
   */
  priorCount: number
  /**
   * The two shares `growth` is computed from: `recentCount / discipline's
   * recent-window corpus` and `priorCount / its prior-window corpus`. The row's
   * before/after bars are drawn from THESE, so a row's chart can never
   * contradict its badge — a topic whose raw count fell while its share rose
   * must not show a shrinking bar beside a positive percentage. `priorShare: 0`
   * is the "new" case (a prior of zero, or one under `MIN_PRIOR_COUNT`) and
   * draws an empty prior bar; `priorCount` still carries the honest raw figure.
   */
  recentShare: number
  priorShare: number
  papers: BoardPaper[]
  /** LLM-written; null when the skill failed for this topic's discipline, or when the model returned no brief whose `key` matched this topic verbatim. */
  why: string | null
  relevant: boolean
}

export interface BoardOverview {
  /** Real OpenAlex work count over the complete recent window, summed across the anchor disciplines (a work matching two anchors is counted twice). */
  totalRecent: number
  topTopicLabel: string | null
  topTopicGrowth: number | null
  relevantCount: number
}

export interface TrendingBoard {
  version: number
  anchors: AnchorDiscipline[]
  overview: BoardOverview
  topics: BoardTopic[]
  breakouts: Array<{ record: PaperRecord; citationCount: number; wikiPageId: string | null }>
  crossDisciplineNote: string | null
  /**
   * Present iff at least one discipline's qualitative survey failed. Carries
   * the diagnostic reason(s) so the cache records a real failure instead of a
   * silent set of null `why`s. The UI intentionally translates this into
   * provider-neutral retry guidance because a cached provider error may predate
   * the user's current settings. Failed structured calls stay metered: their
   * spend is still accumulated into the `trending_refresh` event.
   */
  surveyError?: string
  /**
   * Present iff a DETERMINISTIC retrieval step failed: a discipline's topic
   * grouping, a corpus-size count, or a candidate's prior-count lookup. Those
   * failures correctly DROP the affected rows (never falling back to raw
   * counts), which means they can silently empty the whole leaderboard — and an
   * empty leaderboard renders "No topic cleared the activity threshold", a
   * confident statement about the data when the truth is a failed fetch.
   * Carrying the reason applies the same failure-honesty rule the LLM layer
   * already follows via `surveyError`.
   */
  dataError?: string
  generatedAt: string
}
