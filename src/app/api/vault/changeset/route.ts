import type { Changeset } from "@/lib/vault/types"
import { applyChangeset, revertChangeset, ChangesetConflictError } from "@/lib/vault/changesets"
import { getServerVault } from "@/lib/server/vault"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function isValidChangeset(cs: unknown): cs is Changeset {
  if (!cs || typeof cs !== "object") return false
  const c = cs as Record<string, unknown>
  return typeof c.id === "string" && Array.isArray(c.changes)
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
  const { action, changeset } = parsed as { action?: unknown; changeset?: unknown }

  if (action !== "apply" && action !== "revert") {
    return jsonResponse(400, { error: "action must be \"apply\" or \"revert\"" })
  }
  if (!isValidChangeset(changeset)) {
    return jsonResponse(400, { error: "changeset is required and must have id and changes[]" })
  }

  const storage = await getServerVault()

  try {
    if (action === "apply") await applyChangeset(storage, changeset)
    else await revertChangeset(storage, changeset)
  } catch (err) {
    if (err instanceof ChangesetConflictError) {
      return jsonResponse(409, { error: err.message })
    }
    const message = err instanceof Error ? err.message : String(err)
    if (/conflict/i.test(message)) {
      return jsonResponse(409, { error: message })
    }
    return jsonResponse(500, { error: message })
  }

  return jsonResponse(200, { ok: true })
}
