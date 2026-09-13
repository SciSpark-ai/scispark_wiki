import {
  ChangesetConflictError,
  ChangesetInvalidError,
  ChangesetNotFoundError,
  ChangesetStateError,
} from "@/lib/vault/changesets"
import { listChangesetHistory } from "@/lib/vault/history"
import { undoChangeset } from "@/lib/vault/mutations"
import { getServerVault } from "@/lib/server/vault"

export async function GET(): Promise<Response> {
  try {
    const storage = await getServerVault()
    return Response.json({ changes: await listChangesetHistory(storage) }, { status: 200 })
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return Response.json({ error: "malformed JSON body" }, { status: 400 })
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return Response.json({ error: "body must contain only changesetId" }, { status: 400 })
  }
  const body = parsed as Record<string, unknown>
  if (
    Object.keys(body).length !== 1 ||
    typeof body.changesetId !== "string" ||
    body.changesetId.length === 0
  ) {
    return Response.json({ error: "body must contain only changesetId" }, { status: 400 })
  }

  try {
    const storage = await getServerVault()
    return Response.json(await undoChangeset(storage, body.changesetId), { status: 200 })
  } catch (error) {
    if (error instanceof ChangesetNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof ChangesetInvalidError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof ChangesetStateError) {
      return Response.json({
        error: error.message,
        status: error.classification.status,
        divergedPaths: error.classification.divergedPaths,
      }, { status: 409 })
    }
    if (error instanceof ChangesetConflictError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
