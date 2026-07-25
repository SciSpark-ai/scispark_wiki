import { searchArxiv } from "./arxiv"
import { searchOpenAlex, countOpenAlexWorks, groupWorksByPublicationDate, groupWorksByTopic, groupWorksByTopicField, type GroupEntry } from "./openalex"
import type { SearchFn } from "../skills/feed"
import type { CountFn, GroupFn } from "../trending/weekly-volume"

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
        return await searchArxiv({ query, limit, fromDate: opts?.fromDate })
      }
      return await searchOpenAlex({ query, limit, fromDate: opts?.fromDate }, { mailto, apiKey })
    } catch (err) {
      console.warn(`[node-search] search failed for source=${source} query="${query}":`, err)
      return []
    }
  }
}

/**
 * Node CountFn for trending: calls countOpenAlexWorks directly, threading
 * OPENALEX_MAILTO so count requests land in OpenAlex's polite pool — same
 * politeness contract nodeSearchFn uses for the search path. A failing count
 * throws (fetchWeeklyVolume catches it and falls back to the sample series).
 *
 * `q` is forwarded verbatim, so an optional `topicId` reaches the adapter's
 * `primary_topic.id` filter unchanged. That makes this ONE factory serve all
 * three trending count needs — the leaderboard's per-candidate PRIOR-count
 * lookup (the 200-bucket-horizon bypass, SP4 §3), the per-topic sparkline
 * fallback, and the anchor-wide recent totals — rather than three near-identical
 * wrappers over the same request.
 */
export function nodeCountFn(): CountFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return (q) => countOpenAlexWorks(q, { mailto, apiKey })
}

/**
 * Node GroupFn for trending weekly-volume: calls groupWorksByPublicationDate
 * directly (one group_by=publication_date request, 1 OpenAlex credit),
 * threading OPENALEX_MAILTO/OPENALEX_API_KEY exactly like nodeCountFn. Tried
 * first by fetchWeeklyVolume before falling back to nodeCountFn's per-week path.
 * `q` is forwarded verbatim, so an optional `topicId` reaches the adapter's
 * `primary_topic.id` filter and the leaderboard's sparkline stays scoped to the
 * same topic its growth badge was computed from.
 */
export function nodeGroupFn(): GroupFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return (q) => groupWorksByPublicationDate(q, { mailto, apiKey })
}

/**
 * Query shape shared by every group_by-based node function (nodeGroupFn,
 * nodeTopicGroupFn, nodeTopicFieldGroupFn): a query plus a date range.
 */
export type TopicGroupFn = (q: { query: string; fromDate: string; toDate: string }) => Promise<GroupEntry[]>

/**
 * Node TopicGroupFn for trending's "heating topics" leaderboard (SP4): calls
 * groupWorksByTopic directly (one group_by=primary_topic.id request, 1
 * OpenAlex credit), threading OPENALEX_MAILTO/OPENALEX_API_KEY exactly like
 * nodeGroupFn.
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
 * exactly like nodeGroupFn.
 */
export function nodeTopicFieldGroupFn(): TopicGroupFn {
  const mailto = process.env.OPENALEX_MAILTO
  const apiKey = process.env.OPENALEX_API_KEY
  return (q) => groupWorksByTopicField(q, { mailto, apiKey })
}
