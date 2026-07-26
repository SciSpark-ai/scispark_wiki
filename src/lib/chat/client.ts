import { readNdjson } from "../server/ndjson"
import type { AskChatInput, AskChatResult } from "./orchestrator"

/**
 * Browser-side caller for the KB-chat route (SP5 Task 6) — the UI-only half of
 * the local-runtime split: the whole pipeline (bundle, skills, keys, session
 * files) runs server-side, and `/chat` just POSTs a question and renders what
 * comes back.
 *
 * Imports `readNdjson` from `../server/ndjson` (a truly isomorphic module) and
 * NOT from `../server/skill-route`, which pulls `getServerVault` →
 * `node:fs/promises` into the client bundle — see that file's header comment;
 * `../skills/ingest-client.ts` is the shape this mirrors.
 *
 * The orchestrator import is `import type` only, so nothing server-side is
 * pulled in: the types are erased at compile time.
 */

export type ChatStage = "selecting" | "answering"

/**
 * POST /api/skills/chat with an `AskChatInput`; streams NDJSON progress
 * (`onStage` fires as each stage starts: "selecting" → "answering") and
 * resolves with `{sessionId, message}`.
 *
 * A DEGRADED turn still resolves — the assistant message carries `error` (the
 * answer step failed) and/or `selectionFallback`/`skippedPageIds`, and the
 * caller renders them. Only a request-level failure rejects.
 */
export async function askChatRemote(
  input: AskChatInput,
  onStage?: (stage: ChatStage) => void,
  fetchFn: typeof fetch = fetch,
): Promise<AskChatResult> {
  const res = await fetchFn("/api/skills/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  return readNdjson(res, (event) => {
    if (event?.type === "progress" && typeof event.stage === "string") onStage?.(event.stage as ChatStage)
  }) as Promise<AskChatResult>
}
