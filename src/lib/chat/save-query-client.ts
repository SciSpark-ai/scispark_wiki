import type { SaveAnswerAsQueryOpts, SaveAnswerAsQueryResult } from "./save-query"

/**
 * Browser-side caller for `POST /api/skills/chat/save` (SP5 Task 9) — the
 * "Save to knowledge base" control `MessageBubble` renders. Mirrors
 * `applyChangesetRemote`'s shape (`src/lib/vault/changeset-client.ts`): a
 * non-ok response is surfaced as a thrown `Error` carrying the server's
 * `{error}` message rather than resolving with a degraded value, since a
 * failed save has no partial-success form worth rendering — the caller
 * either shows the error or the resulting page link.
 *
 * `SaveAnswerAsQueryOpts`/`SaveAnswerAsQueryResult` are imported as TYPES
 * only, so nothing from `./save-query` (which calls `applyChangeset`
 * directly against a `VaultStorage`) is pulled into the client bundle.
 */

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}

export async function saveAnswerAsQueryRemote(
  opts: SaveAnswerAsQueryOpts,
  fetchFn: typeof fetch = fetch,
): Promise<SaveAnswerAsQueryResult> {
  const res = await fetchFn("/api/skills/chat/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `save failed (${res.status})`))
  }
  const body = (await res.json()) as { result: SaveAnswerAsQueryResult }
  return body.result
}
