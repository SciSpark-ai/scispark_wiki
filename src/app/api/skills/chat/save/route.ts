import { jsonSkillRoute } from "@/lib/server/skill-route"
import { saveAnswerAsQuery, type SaveAnswerAsQueryOpts, type SaveAnswerAsQueryResult } from "@/lib/chat/save-query"

/**
 * POST /api/skills/chat/save — body `SaveAnswerAsQueryOpts`
 * (`{question, answer, sessionId, citedPageIds, today?}`), JSON result
 * `SaveAnswerAsQueryResult` (`{changesetId, pageId}`): "Save to Wiki" for a
 * chat answer worth keeping — writes it as a `query` wiki page via
 * `saveAnswerAsQuery`, which is deterministic and LLM-free (no model call
 * here). A thrown error (e.g. a vault failure) becomes the usual
 * `jsonSkillRoute` 500 `{error}` response.
 */
export const POST = jsonSkillRoute<SaveAnswerAsQueryOpts, SaveAnswerAsQueryResult>(async (input, vault) => {
  return saveAnswerAsQuery(vault, input)
})
