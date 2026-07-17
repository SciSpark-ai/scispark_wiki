import type { EnrichResult } from "./enrich"

/**
 * Browser-side caller for `POST /api/skills/enrich`. Fires after a tier-1
 * save (background, not awaited) and from the paper page's Enrich button —
 * see `savePaper`/`/paper/[key]`.
 *
 * Deliberately imports only the `EnrichResult` TYPE from `./enrich` (erased
 * at build time) — never `enrichSkill`, which pulls the LLM harness — so
 * this stays a clean client module, matching `search-intent-client.ts`.
 *
 * Never throws: any failure (network, non-200, malformed body) resolves to
 * `{applied: false}`, so a flaky enrich run can never surface as an error to
 * the save flow it rides along with.
 */
export interface EnrichRemoteResult {
  applied: boolean
  tldr?: EnrichResult["tldr"]
  tags?: EnrichResult["tags"]
}

export async function enrichRemote(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<EnrichRemoteResult> {
  try {
    const res = await fetchFn("/api/skills/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    })
    if (!res.ok) return { applied: false }
    const body = (await res.json()) as { result?: EnrichRemoteResult }
    if (!body?.result?.applied) return { applied: false }
    return { applied: true, tldr: body.result.tldr, tags: body.result.tags }
  } catch {
    return { applied: false }
  }
}
