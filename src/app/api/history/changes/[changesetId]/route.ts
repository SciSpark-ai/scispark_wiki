import {
  ChangesetInvalidError,
  ChangesetNotFoundError,
} from "@/lib/vault/changesets"
import { getChangesetPreview } from "@/lib/vault/history"
import { getServerVault } from "@/lib/server/vault"

export async function GET(
  _request: Request,
  context: { params: Promise<{ changesetId: string }> },
): Promise<Response> {
  const { changesetId } = await context.params
  try {
    const storage = await getServerVault()
    return Response.json(await getChangesetPreview(storage, changesetId), { status: 200 })
  } catch (error) {
    if (error instanceof ChangesetNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof ChangesetInvalidError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
