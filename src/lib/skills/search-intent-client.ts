import type { SearchSort } from "./search-intent"

/**
 * Browser-side caller for the search-intent skill route. `src/app/papers/page.tsx`
 * calls this before `/api/search/[source]` so the user's query is classified as
 * relevance- vs recency-oriented and the search adapters rank accordingly.
 *
 * Deliberately imports only the `SearchSort` TYPE from `./search-intent` (erased
 * at build time) — never `searchIntentSkill`, which pulls the LLM harness — so
 * this stays a clean client module, matching `feed-client.ts`/`ingest-client.ts`.
 *
 * Never throws: any failure (network, non-200, malformed body) resolves to
 * `"relevance"`, the adapters' own safe default, so a classifier hiccup can never
 * block or break the actual search. Results are memoized per normalized query for
 * the page's lifetime so repeat searches don't re-pay for the `fast`-tier call.
 */

const cache = new Map<string, SearchSort>()

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ")
}

export async function classifySearchIntentRemote(
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<SearchSort> {
  const key = normalize(query)
  if (key === "") return "relevance"
  const cached = cache.get(key)
  if (cached) return cached

  try {
    const res = await fetchFn("/api/skills/search-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) return "relevance"
    const body = (await res.json()) as { result?: { sort?: SearchSort } }
    const sort = body?.result?.sort === "date" ? "date" : "relevance"
    cache.set(key, sort)
    return sort
  } catch {
    return "relevance"
  }
}

/** Test-only: clears the per-session intent memo. */
export function __clearSearchIntentCache(): void {
  cache.clear()
}
