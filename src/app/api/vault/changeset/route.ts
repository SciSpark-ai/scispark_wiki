import {
  parseChangeset,
  ChangesetConflictError,
  ChangesetInvalidError,
  ChangesetNotFoundError,
  ChangesetStateError,
} from "@/lib/vault/changesets"
import { commitChangeset, undoChangeset } from "@/lib/vault/mutations"
import { getServerVault } from "@/lib/server/vault"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(req: Request): Promise<Response> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return jsonResponse(400, { error: "malformed JSON body" })
  }

  if (!parsed || typeof parsed !== "object") {
    return jsonResponse(400, { error: "malformed request body" })
  }
  const body = parsed as Record<string, unknown>
  const { action, changeset, changesetId } = body as {
    action?: unknown
    changeset?: unknown
    changesetId?: unknown
  }

  if (action !== "apply" && action !== "revert") {
    return jsonResponse(400, { error: "action must be \"apply\" or \"revert\"" })
  }
  const expectedKeys = action === "apply" ? ["action", "changeset"] : ["action", "changesetId"]
  const requestKeys = Object.keys(body)
  if (
    requestKeys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => requestKeys.includes(key))
  ) {
    return jsonResponse(400, {
      error:
        action === "apply"
          ? "apply accepts a changeset only"
          : "revert accepts changesetId only",
    })
  }
  const storage = await getServerVault()
  let result: Awaited<ReturnType<typeof commitChangeset>>

  try {
    if (action === "apply") {
      result = await commitChangeset(storage, parseChangeset(changeset))
    } else {
      if (typeof changesetId !== "string") {
        return jsonResponse(400, { error: "changesetId is required for revert" })
      }
      result = await undoChangeset(storage, changesetId)
    }
  } catch (err) {
    if (err instanceof ChangesetNotFoundError) {
      return jsonResponse(404, { error: err.message })
    }
    if (err instanceof ChangesetInvalidError) {
      return jsonResponse(400, { error: err.message })
    }
    if (err instanceof ChangesetStateError) {
      return jsonResponse(409, {
        error: err.message,
        status: err.classification.status,
        divergedPaths: err.classification.divergedPaths,
      })
    }
    if (err instanceof ChangesetConflictError) {
      return jsonResponse(409, { error: err.message })
    }
    const message = err instanceof Error ? err.message : String(err)
    if (/conflict/i.test(message)) {
      return jsonResponse(409, { error: message })
    }
    return jsonResponse(500, { error: message })
  }

  return jsonResponse(200, { ok: true, ...result })
}
