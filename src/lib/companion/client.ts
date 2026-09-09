import type { CompanionUtterance } from "./run"
import { readNdjson } from "../server/ndjson"

/**
 * Browser-side caller for the companion utterance skill route (M11 Task 9).
 * Reports the current route. The server owns event detection, persisted
 * delivery history, and frequency limits. Legacy counts remain optional for
 * compatibility and cannot reset server-owned limits.
 *
 * `CompanionUtterance` is imported with `import type` from `./run`, which is
 * erased at compile time — none of that module's runtime code (skill runner,
 * trigger evaluation, storage access) reaches the client bundle, mirroring
 * `../reader/client.ts`'s `import type` of `ReadingCompanionInput`.
 */

export interface CompanionRemoteInput {
  route: string
  sessionShownCount?: number
  lastShownTs?: Record<string, string>
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}

/**
 * POST /api/skills/companion with `{route}`;
 * resolves with `CompanionUtterance | null` — a real `null` result (no
 * trigger eligible / budget exhausted / chattiness off) is a normal, non-error
 * outcome and resolves rather than throwing. Only a genuinely failed request
 * (network error, non-2xx response) throws.
 */
export async function companionUtteranceRemote(
  input: CompanionRemoteInput,
  fetchFn: typeof fetch = fetch,
  onText?: (draft: CompanionUtterance) => void,
  signal?: AbortSignal,
): Promise<CompanionUtterance | null> {
  const res = await fetchFn("/api/skills/companion", {
    method: "POST",
    headers: { "content-type": "application/json", ...(onText ? { accept: "application/x-ndjson" } : {}) },
    body: JSON.stringify(input),
    signal,
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `companion failed (${res.status})`))
  }
  if (res.headers.get("content-type")?.includes("application/x-ndjson")) {
    return readNdjson(res, (event) => {
      const draft = event.draft as CompanionUtterance | undefined
      if (event.type === "text" && typeof draft?.text === "string" && typeof draft.trigger === "string") onText?.(draft)
    }) as Promise<CompanionUtterance | null>
  }
  const body = (await res.json()) as { result: CompanionUtterance | null }
  return body.result
}
