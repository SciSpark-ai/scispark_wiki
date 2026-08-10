import {
  ChangesetConflictError,
  ChangesetInvalidError,
  ChangesetNotFoundError,
  ChangesetStateError,
} from "@/lib/vault/changesets"
import { listChangesetHistory } from "@/lib/vault/history"
import { undoChangeset } from "@/lib/vault/mutations"
import { getServerVault } from "@/lib/server/vault"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function GET(): Promise<Response> {
  try {
    const storage = await getServerVault()
    return jsonResponse(200, { changes: await listChangesetHistory(storage) })
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function POST(request: Request): Promise<Response> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return jsonResponse(400, { error: "malformed JSON body" })
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return jsonResponse(400, { error: "body must contain only changesetId" })
  }
  const body = parsed as Record<string, unknown>
  if (
    Object.keys(body).length !== 1 ||
    typeof body.changesetId !== "string" ||
    body.changesetId.length === 0
  ) {
    return jsonResponse(400, { error: "body must contain only changesetId" })
  }

  try {
    const storage = await getServerVault()
    return jsonResponse(200, await undoChangeset(storage, body.changesetId))
  } catch (error) {
    if (error instanceof ChangesetNotFoundError) {
      return jsonResponse(404, { error: error.message })
    }
    if (error instanceof ChangesetInvalidError) {
      return jsonResponse(400, { error: error.message })
    }
    if (error instanceof ChangesetStateError) {
      return jsonResponse(409, {
        error: error.message,
        status: error.classification.status,
        divergedPaths: error.classification.divergedPaths,
      })
    }
    if (error instanceof ChangesetConflictError) {
      return jsonResponse(409, { error: error.message })
    }
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
