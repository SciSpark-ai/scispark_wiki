import type { Changeset } from "./types"

/**
 * Browser-side caller for `POST /api/vault/changeset` (M11 Task 9). Any code
 * that used to call `applyChangeset(storage, changeset)` directly against a
 * `RemoteVaultStorage` (which would decompose into N separate `/api/vault/file`
 * HTTP round-trips — non-atomic across the network) now calls
 * `applyChangesetRemote` instead, which POSTs the whole changeset in one
 * request and lets the server apply it atomically via the same
 * `applyChangeset`/`revertChangeset` the route already wraps
 * (`src/app/api/vault/changeset/route.ts`, built in M11 Task 2).
 */

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}

/**
 * POST /api/vault/changeset with `{action: "apply", changeset}`. Resolves on
 * success; a non-ok response (400 invalid, 409 conflict, 500 unexpected) is
 * surfaced as a thrown `Error` carrying the server's `{error}` message.
 */
export async function applyChangesetRemote(changeset: Changeset, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn("/api/vault/changeset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "apply", changeset }),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `changeset apply failed (${res.status})`))
  }
}
