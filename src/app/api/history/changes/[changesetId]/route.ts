import {
  ChangesetInvalidError,
  ChangesetNotFoundError,
} from "@/lib/vault/changesets"
import { getChangesetPreview } from "@/lib/vault/history"
import { getServerVault } from "@/lib/server/vault"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ changesetId: string }> },
): Promise<Response> {
  const { changesetId } = await context.params
  try {
    const storage = await getServerVault()
    return jsonResponse(200, await getChangesetPreview(storage, changesetId))
  } catch (error) {
    if (error instanceof ChangesetNotFoundError) {
      return jsonResponse(404, { error: error.message })
    }
    if (error instanceof ChangesetInvalidError) {
      return jsonResponse(400, { error: error.message })
    }
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
