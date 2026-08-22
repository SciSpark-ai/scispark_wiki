import type { ChangesetMutationResult } from "../vault/mutations"
import type {
  ChangesetHistoryPreview,
  ChangesetHistoryRecord,
} from "../vault/history"

export class HistoryApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public divergedPaths: string[] = [],
  ) {
    super(message)
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  fetchFn: typeof fetch,
): Promise<T> {
  const response = await fetchFn(url, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const record = typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : {}
    throw new HistoryApiError(
      response.status,
      typeof record.error === "string" ? record.error : `history request failed (${response.status})`,
      Array.isArray(record.divergedPaths) && record.divergedPaths.every((path) => typeof path === "string")
        ? record.divergedPaths
        : [],
    )
  }
  return body as T
}

export async function listChangesRemote(fetchFn: typeof fetch = fetch): Promise<ChangesetHistoryRecord[]> {
  const body = await requestJson<{ changes: ChangesetHistoryRecord[] }>(
    "/api/history/changes",
    undefined,
    fetchFn,
  )
  return body.changes
}

export function getChangePreviewRemote(
  changesetId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ChangesetHistoryPreview> {
  return requestJson(
    `/api/history/changes/${encodeURIComponent(changesetId)}`,
    undefined,
    fetchFn,
  )
}

export function undoChangeRemote(
  changesetId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ChangesetMutationResult> {
  return requestJson(
    "/api/history/changes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changesetId }),
    },
    fetchFn,
  )
}
