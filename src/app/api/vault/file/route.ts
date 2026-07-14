import { posix } from "node:path"
import { getServerVault } from "@/lib/server/vault"

/**
 * LLM settings (API keys) must be unreachable through the generic vault file
 * API — it's a raw passthrough to storage, with no concept of "this path is
 * secret". Keys are managed exclusively via `/api/settings` (M11 Task 4),
 * which redacts them on GET and merges patches on PUT; this route rejects
 * both GET and PUT of that one path so a client can't route around the
 * redaction by reading/writing the file directly (M11 Task 10 carry-forward).
 * Every other `.scispark/*` file (events, usage, run records, etc.) is
 * unaffected.
 *
 * The guard compares the *normalized* path, not the raw query string: storage
 * resolves paths with `node:path` `resolve()`, which collapses `.` segments
 * and repeated slashes, so a raw string compare against
 * ".scispark/settings.json" is bypassable with e.g.
 * "./.scispark/settings.json", ".//.scispark/settings.json",
 * ".scispark//settings.json", or ".scispark/./settings.json" — all of which
 * resolve to the exact same file on disk. `posix.normalize` is used (not the
 * OS-default `normalize`) because vault paths are always forward-slash POSIX
 * paths regardless of host OS, matching how `NodeFsVaultStorage.abs()`
 * resolves paths.
 */
const PROTECTED_PATH = ".scispark/settings.json"

function isProtectedPath(path: string): boolean {
  return posix.normalize(path) === PROTECTED_PATH
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function requirePath(req: Request): string | null {
  const path = new URL(req.url).searchParams.get("path")
  return path && path.length > 0 ? path : null
}

export async function GET(req: Request): Promise<Response> {
  const path = requirePath(req)
  if (!path) return jsonResponse(400, { error: "path is required" })
  if (isProtectedPath(path)) {
    return jsonResponse(403, { error: "settings are managed via /api/settings" })
  }

  try {
    const storage = await getServerVault()
    const bytes = await storage.readBinary(path)
    if (bytes === null) return jsonResponse(404, { error: "not found" })

    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse(500, { error: message })
  }
}

export async function PUT(req: Request): Promise<Response> {
  const path = requirePath(req)
  if (!path) return jsonResponse(400, { error: "path is required" })
  if (isProtectedPath(path)) {
    return jsonResponse(403, { error: "settings are managed via /api/settings" })
  }

  try {
    const bytes = new Uint8Array(await req.arrayBuffer())
    const storage = await getServerVault()

    if (req.headers.get("x-vault-text") === "1") {
      await storage.write(path, new TextDecoder("utf-8").decode(bytes))
    } else {
      await storage.writeBinary(path, bytes)
    }

    return new Response(null, { status: 204 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse(500, { error: message })
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const path = requirePath(req)
  if (!path) return jsonResponse(400, { error: "path is required" })

  try {
    const storage = await getServerVault()
    await storage.delete(path)

    return new Response(null, { status: 204 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse(500, { error: message })
  }
}
