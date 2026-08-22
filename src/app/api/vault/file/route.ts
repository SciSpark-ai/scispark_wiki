import { resolve } from "node:path"
import { getServerVault } from "@/lib/server/vault"
import { isSafeVaultRelativePath } from "@/lib/vault/safe-path"

/**
 * LLM settings (API keys) must be unreachable through the generic vault file
 * API — it's a raw passthrough to storage, with no concept of "this path is
 * secret". Keys are managed exclusively via `/api/settings` (M11 Task 4),
 * which redacts them on GET and merges patches on PUT; this route rejects
 * GET, PUT, and DELETE of that one path so a client can't route around the
 * redaction (or wipe the keys outright) by reading/writing/deleting the file
 * directly (M11 Task 10 carry-forward; DELETE guard added in final review —
 * it had been overlooked even though this comment always claimed the route
 * "rejects" the path). Changeset audit records remain readable for backup and
 * review compatibility, but generic clients cannot write or delete them; the
 * server mutation coordinator is their only writer. Other `.scispark/*` app
 * data (events, usage, run records, etc.) is unaffected.
 *
 * The guard must agree with how storage actually resolves a path, not with a
 * second independent normalizer. A prior version used `posix.normalize()`,
 * which is NOT the same algorithm `NodeFsVaultStorage.abs()` uses
 * (`path.resolve(this.root, path)`), and the two disagree on real bypasses:
 *   - `posix.normalize` KEEPS a trailing slash ("foo/" stays "foo/"), while
 *     `resolve()` STRIPS it — so "?path=.scispark/settings.json/" (or "//")
 *     compared unequal under normalize() but resolves to the exact real file
 *     under resolve(), silently opening it.
 *   - Neither is case-insensitive, so on a case-insensitive filesystem
 *     (macOS APFS, Windows NTFS — both local-runtime targets) a differently
 *     -cased path like ".scispark/SETTINGS.json" resolves to the same file on
 *     disk but compares unequal as a string.
 *
 * The fix: resolve the requested path against a fixed sentinel root using the
 * exact same `path.resolve()` call `abs()` uses, then compare case-
 * -insensitively against the canonical path resolved the same way. This
 * collapses "." segments, repeated/trailing slashes, ".." traversal, and case
 * in one place, and is guaranteed consistent with `abs()` because it's the
 * same resolve() semantics. Case-insensitive comparison means a genuinely
 * different, differently-cased file on a case-sensitive filesystem could be
 * blocked as a false positive — that's the safe direction for a secrets file.
 */
const SENTINEL_ROOT = resolve("/__vault_root__")
const PROTECTED_ABS = resolve(SENTINEL_ROOT, ".scispark/settings.json").toLowerCase()
const CHANGESETS_ABS = resolve(SENTINEL_ROOT, ".scispark/changesets").toLowerCase()

function isProtectedPath(path: string): boolean {
  return resolve(SENTINEL_ROOT, path).toLowerCase() === PROTECTED_ABS
}

function isChangesetAuditPath(path: string): boolean {
  const resolved = resolve(SENTINEL_ROOT, path).toLowerCase()
  return resolved === CHANGESETS_ABS || resolved.startsWith(`${CHANGESETS_ABS}/`)
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

function invalidPathResponse(): Response {
  return jsonResponse(400, { error: "path must be a safe vault-relative path" })
}

export async function GET(req: Request): Promise<Response> {
  const path = requirePath(req)
  if (!path) return jsonResponse(400, { error: "path is required" })
  if (isProtectedPath(path)) {
    return jsonResponse(403, { error: "settings are managed via /api/settings" })
  }
  if (!isSafeVaultRelativePath(path)) return invalidPathResponse()

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
  if (!isSafeVaultRelativePath(path)) return invalidPathResponse()
  if (isChangesetAuditPath(path)) {
    return jsonResponse(403, { error: "changeset audit records are server-managed" })
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
  if (isProtectedPath(path)) {
    return jsonResponse(403, { error: "settings are managed via /api/settings" })
  }
  if (!isSafeVaultRelativePath(path)) return invalidPathResponse()
  if (isChangesetAuditPath(path)) {
    return jsonResponse(403, { error: "changeset audit records are server-managed" })
  }

  try {
    const storage = await getServerVault()
    await storage.delete(path)

    return new Response(null, { status: 204 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse(500, { error: message })
  }
}
