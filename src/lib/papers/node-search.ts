import { searchArxiv } from "./arxiv"
import { searchS2 } from "./s2"
import { searchPubmed } from "./pubmed"
import { getServerS2Key } from "../server/paper-source-settings"
import {
  searchOpenAlex,
  searchTopCitedWorks,
  countOpenAlexWorks,
  groupWorksByTopic,
  groupWorksByTopicField,
  type GroupEntry,
  type TopCitedWorksQuery,
} from "./openalex"
import type { PaperRecord } from "./types"
import type { SearchFn } from "../skills/feed"
import type { CountFn } from "../trending/counts"

/**
 * Node relay-free SearchFn: calls the M3 search-core adapters (searchArxiv,
 * searchOpenAlex) directly — no HTTP server, no /api/search proxy round trip.
 * s2/pubmed queries are remapped onto openalex so callers running server-side
 * (skill routes) get real results for every `source` in `SearchFn` without
 * needing S2/PubMed API keys or hitting their live rate limits. A failed
 * query resolves to [] (per the `SearchFn` contract) rather than failing the
 * whole caller.
 *
 * Lifted verbatim (M11 Task 5) from the proven live-gate helper in
 * src/lib/spark/__tests__/live-spark.test.ts (itself mirroring the M5 live
 * gate's nodeSearchFn, src/lib/skills/__tests__/live-feed.test.ts) — now
 * production code so every server-side skill route (trending, feed, spark)
 * shares one Node search implementation instead of each route re-deriving
 * its own. The browser-side `SearchFn` (src/lib/skills/feed.ts) is unused
 * after M11: the server now owns search for every skill route.
 */
export function nodeSearchFn(): SearchFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return async (source, query, limit, opts) => {
    const effectiveSource = source === "s2" || source === "pubmed" ? "openalex" : source
    try {
      if (effectiveSource === "arxiv") {
        // SP2.1 freshness: opts.fromDate threads to each adapter's own date
        // mechanism (arXiv submittedDate range / OpenAlex from_publication_date).
        return await searchArxiv({ query, limit, fromDate: opts?.fromDate, sort: opts?.sort })
      }
      return await searchOpenAlex({ query, limit, fromDate: opts?.fromDate, sort: opts?.sort }, { mailto, apiKey })
    } catch (err) {
      console.warn(`[node-search] search failed for source=${source} query="${query}":`, err)
      return []
    }
  }
}

/** Feed v2: actual source routing, native date bounds, and errors propagated to
 * the pipeline's per-query diagnostics. Legacy Spark routing above is unchanged. */
export function nodeFeedSearchFn(): SearchFn {
  return async (source, query, limit, opts) => {
    switch (source) {
      case "arxiv": return searchArxiv({ query, limit, fromDate: opts?.fromDate, sort: opts?.sort })
      case "openalex": return searchOpenAlex(
        { query, limit, fromDate: opts?.fromDate, sort: opts?.sort },
        { mailto: process.env.OPENALEX_MAILTO, apiKey: process.env.OPENALEX_API_KEY },
      )
      case "s2": return searchS2({ query, limit, fromDate: opts?.fromDate }, { apiKey: await getServerS2Key(), signal: opts?.signal })
      case "pubmed": return searchPubmed({ query, limit, fromDate: opts?.fromDate }, { apiKey: process.env.NCBI_API_KEY, signal: opts?.signal })
      default: throw new Error("Unsupported paper source")
    }
  }
}

/** Direct multi-source search for the user-driven Search page. Unlike the
 * feed-oriented nodeSearchFn above, this preserves the selected source instead
 * of remapping Semantic Scholar and PubMed through OpenAlex. Individual source
 * failures contribute no papers so one rate-limited index cannot erase results
 * returned by the others. */
export function nodeResearchSearchFn(options: { reportErrors?: boolean } = {}): SearchFn {
  const openAlexMailto = process.env.OPENALEX_MAILTO
  const openAlexApiKey = process.env.OPENALEX_API_KEY
  const ncbiApiKey = process.env.NCBI_API_KEY

  return async (source, query, limit, opts) => {
    try {
      switch (source) {
        case "arxiv":
          return await searchArxiv({ query, limit, fromDate: opts?.fromDate, sort: opts?.sort })
        case "openalex":
          return await searchOpenAlex(
            { query, limit, fromDate: opts?.fromDate, sort: opts?.sort },
            { mailto: openAlexMailto, apiKey: openAlexApiKey },
          )
        case "s2":
          return await searchS2({ query, limit }, { apiKey: await getServerS2Key(), signal: opts?.signal })
        case "pubmed":
          return await searchPubmed({ query, limit }, { apiKey: ncbiApiKey })
      }
      return []
    } catch (err) {
      console.warn(`[research-search] source failed for source=${source}:`, err)
      if (options.reportErrors) throw err
      return []
    }
  }
}

/**
 * Node CountFn for trending: calls countOpenAlexWorks directly, threading
 * OPENALEX_MAILTO so count requests land in OpenAlex's polite pool — same
 * politeness contract nodeSearchFn uses for the search path. A failing count
 * throws; each call site decides how to degrade (a failed prior lookup drops
 * its topic, a failed anchor total falls back to the summed buckets).
 *
 * `q` is forwarded verbatim, so an optional `topicId` reaches the adapter's
 * `primary_topic.id` filter unchanged. That makes this ONE factory serve both
 * trending count needs — the leaderboard's per-candidate PRIOR-count lookup
 * (the 200-bucket-horizon bypass, SP4 §3) and the anchor-wide recent totals —
 * rather than two near-identical wrappers over the same request.
 */
export function nodeCountFn(): CountFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return (q) => countOpenAlexWorks(q, { mailto, apiKey })
}

/**
 * Entity-scoped, citation-ranked works retrieval — see
 * `searchTopCitedWorks`. Trending's ONE paper-retrieval primitive: the
 * leaderboard's representative papers (scoped by `topicId`) and the breakout
 * strip (scoped by an anchor's `fieldId`/label) are the same request with
 * different scopes, so a paper on the board provably belongs to the row it
 * sits under.
 */
export type TopWorksFn = (q: TopCitedWorksQuery) => Promise<PaperRecord[]>

/**
 * Node TopWorksFn: calls searchTopCitedWorks directly, threading
 * OPENALEX_MAILTO/OPENALEX_API_KEY exactly like nodeCountFn. A failing
 * request throws; call sites decide how to degrade (a failed paper fetch
 * yields `papers: []` for that row and never fails the refresh).
 */
export function nodeTopWorksFn(): TopWorksFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return (q) => searchTopCitedWorks(q, { mailto, apiKey })
}

/**
 * Query shape shared by the group_by-based node functions (nodeTopicGroupFn,
 * nodeTopicFieldGroupFn): a query plus a date range.
 */
export type TopicGroupFn = (q: { query: string; fromDate: string; toDate: string; fieldId?: string; subfieldIds?: string[] }) => Promise<GroupEntry[]>

/**
 * Node TopicGroupFn for trending's "heating topics" leaderboard (SP4): calls
 * groupWorksByTopic directly (one group_by=primary_topic.id request, 1
 * OpenAlex credit), threading OPENALEX_MAILTO/OPENALEX_API_KEY exactly like
 * nodeCountFn.
 */
export function nodeTopicGroupFn(): TopicGroupFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return (q) => groupWorksByTopic(q, { mailto, apiKey })
}

/**
 * Node TopicGroupFn for trending's "heating topics" leaderboard (SP4): calls
 * groupWorksByTopicField directly (one group_by=primary_topic.field.id
 * request, 1 OpenAlex credit), threading OPENALEX_MAILTO/OPENALEX_API_KEY
 * exactly like nodeCountFn.
 */
export function nodeTopicFieldGroupFn(): TopicGroupFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return (q) => groupWorksByTopicField(q, { mailto, apiKey })
}
