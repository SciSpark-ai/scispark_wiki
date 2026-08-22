import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import {
  askChat,
  parseAskChatInput,
  type AskChatResult,
} from "@/lib/chat/orchestrator"

/**
 * POST /api/skills/chat — body `AskChatInput` (`{sessionId, question,
 * readSourcesOnly, projectId?}`), NDJSON progress (`{type:"progress", stage}` with stage
 * "selecting" then "answering") and terminal result `AskChatResult`
 * (`{sessionId, message}`).
 *
 * NDJSON, not SSE: `ndjsonSkillRoute` is the streaming mechanism every other
 * long-running skill route already uses (feed refresh, ingest, Deep Spark) —
 * the SP5 spec's "SSE" wording is a spec-level slip the plan records; adding a
 * second transport for one route would be the wrong reading of its intent.
 *
 * The route stays thin on purpose (the M11 shape): `getServerVault()` via the
 * wrapper, `loadSettings(vault)`, `setSkillTestOverrides` for injecting a
 * MockProvider in tests, and `askChat` owning the whole pipeline. A degraded
 * turn (selection fallback, unreadable page, failed answer) is a NORMAL result
 * here, not a terminal error line — `askChat` resolves with an assistant
 * message carrying `error`/`selectionFallback`, and the transcript must render
 * it. Only a failure that prevents producing a message at all (malformed body,
 * vault failure) becomes the terminal error line.
 */
export const POST = ndjsonSkillRoute<unknown>(async (rawInput, vault, emit) => {
  const input = parseAskChatInput(rawInput)
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()

  const result: AskChatResult = await askChat(vault, {
    input,
    settings,
    providerOverride: overrides.providerOverride,
    onProgress: (stage) => emit({ type: "progress", stage }),
  })
  return result
})
