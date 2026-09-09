import type { ReadingCompanionInput, ReadingAnswer } from "../skills/reading-companion"
import { readNdjson } from "../server/ndjson"

/**
 * Browser-side caller for the reading-companion ask skill route (M11 Task 9).
 * `ReaderView` used to build `buildAskContext`'s output itself and pass it
 * straight into `runSkill(readingCompanionSkill, ...)` client-side — it now
 * assembles the same `ReadingCompanionInput` (context assembly stays
 * client-side, see the route's doc comment for why) and POSTs it here, which
 * runs the LLM call server-side and returns the same `ReadingAnswer` shape.
 *
 * `ReadingCompanionInput`/`ReadingAnswer` are imported with `import type` from
 * `../skills/reading-companion`, which is erased at compile time — none of
 * that module's runtime code (skill definition, harness-facing `defineSkill`)
 * reaches the client bundle, mirroring `../spark/client.ts`'s `import type`
 * of `Seed`/`QuickSparkResult` from server-side modules.
 */

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}

/** POST /api/skills/ask with a `ReadingCompanionInput`; resolves with the `ReadingAnswer`. */
export async function askRemote(
  input: ReadingCompanionInput,
  fetchFn: typeof fetch = fetch,
  onText?: (text: string) => void,
): Promise<ReadingAnswer> {
  const res = await fetchFn("/api/skills/ask", {
    method: "POST",
    headers: { "content-type": "application/json", ...(onText ? { accept: "application/x-ndjson" } : {}) },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `ask failed (${res.status})`))
  }
  if (res.headers.get("content-type")?.includes("application/x-ndjson")) {
    return readNdjson(res, (event) => {
      if (event.type === "text" && typeof event.text === "string") onText?.(event.text)
    }) as Promise<ReadingAnswer>
  }
  const body = (await res.json()) as { result: ReadingAnswer }
  return body.result
}
