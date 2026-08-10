import { jsonSkillRoute } from "@/lib/server/skill-route"
import { undoIngest } from "@/lib/skills/ingest"
import type { MutationWarning } from "@/lib/vault/mutations"

/**
 * POST /api/skills/ingest/undo — body `{changesetId}`, JSON result
 * `{ok: true}` on success. A thrown error (e.g. unknown changeset id)
 * becomes the usual `jsonSkillRoute` 500 `{error}` response, which
 * `undoIngestRemote` surfaces to the papers page's undo affordance exactly
 * like the prior direct `undoIngest(vault, changesetId)` call did.
 */
export const POST = jsonSkillRoute<
  { changesetId: string },
  { ok: true; changesetId: string; warnings: MutationWarning[] }
>(async ({ changesetId }, vault) => {
  const mutation = await undoIngest(vault, changesetId)
  return { ok: true, ...mutation }
})
