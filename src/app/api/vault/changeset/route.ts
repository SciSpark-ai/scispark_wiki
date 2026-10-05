import {
  parseChangeset,
  ChangesetConflictError,
  ChangesetInvalidError,
  ChangesetNotFoundError,
  ChangesetStateError,
} from "@/lib/vault/changesets"
import { commitChangeset, undoChangeset } from "@/lib/vault/mutations"
import { getServerVault } from "@/lib/server/vault"

export async function POST(req: Request): Promise<Response> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return Response.json({ error: "malformed JSON body" }, { status: 400 })
  }

  if (!parsed || typeof parsed !== "object") {
    return Response.json({ error: "malformed request body" }, { status: 400 })
  }
  const body = parsed as Record<string, unknown>
  const { action, changeset, changesetId } = body as {
    action?: unknown
    changeset?: unknown
    changesetId?: unknown
  }

  if (action !== "apply" && action !== "revert") {
    return Response.json({ error: "action must be \"apply\" or \"revert\"" }, { status: 400 })
  }
  const expectedKeys = action === "apply" ? ["action", "changeset"] : ["action", "changesetId"]
  const requestKeys = Object.keys(body)
  if (
    requestKeys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => requestKeys.includes(key))
  ) {
    return Response.json({
      error:
        action === "apply"
          ? "apply accepts a changeset only"
          : "revert accepts changesetId only",
    }, { status: 400 })
  }
  const storage = await getServerVault()
  let result: Awaited<ReturnType<typeof commitChangeset>>

  try {
    if (action === "apply") {
      result = await commitChangeset(storage, parseChangeset(changeset))
    } else {
      if (typeof changesetId !== "string") {
        return Response.json({ error: "changesetId is required for revert" }, { status: 400 })
      }
      result = await undoChangeset(storage, changesetId)
    }
  } catch (err) {
    if (err instanceof ChangesetNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ChangesetInvalidError) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof ChangesetStateError) {
      return Response.json({
        error: err.message,
        status: err.classification.status,
        divergedPaths: err.classification.divergedPaths,
      }, { status: 409 })
    }
    if (err instanceof ChangesetConflictError) {
      return Response.json({ error: err.message }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : String(err)
    if (/conflict/i.test(message)) {
      return Response.json({ error: message }, { status: 409 })
    }
    return Response.json({ error: message }, { status: 500 })
  }

  return Response.json({ ok: true, ...result }, { status: 200 })
}
