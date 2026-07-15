import { searchArxiv } from "./arxiv"
import { searchOpenAlex } from "./openalex"
import type { SearchFn } from "../skills/feed"

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
 * its own. `browserSearchFn` (src/lib/skills/feed.ts) remains for nothing
 * after M11: the server now owns search for every skill route.
 */
export function nodeSearchFn(): SearchFn {
  const mailto = process.env.OPENALEX_MAILTO
  return async (source, query, limit) => {
    const effectiveSource = source === "s2" || source === "pubmed" ? "openalex" : source
    try {
      if (effectiveSource === "arxiv") {
        return await searchArxiv({ query, limit })
      }
      return await searchOpenAlex({ query, limit }, { mailto })
    } catch (err) {
      console.warn(`[node-search] search failed for source=${source} query="${query}":`, err)
      return []
    }
  }
}
