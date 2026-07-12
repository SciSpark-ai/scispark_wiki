import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate"
import type { VaultStorage } from "./storage"

// Paths that must never leave the device via vault export, and must never be
// ingested from an imported vault. Today this is just .scispark/settings.json,
// which stores BYOK provider API keys in plaintext (src/lib/llm/settings.ts) —
// exporting it would hand out live billing credentials to whoever the vault is
// shared with, and importing it would clobber the importer's own keys with the
// sharer's. Keep this list here so future secret-bearing files get added too.
const SENSITIVE_PATHS = [".scispark/settings.json"]

export async function exportVaultZip(storage: VaultStorage): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {}
  for (const path of await storage.list()) {
    if (SENSITIVE_PATHS.includes(path)) continue
    const content = await storage.read(path)
    if (content !== null) entries[path] = strToU8(content)
  }
  return zipSync(entries)
}

export async function importVaultZip(
  storage: VaultStorage,
  data: Uint8Array,
): Promise<{ files: number }> {
  const entries = unzipSync(data)
  let files = 0
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith("/")) continue // directory entries
    if (SENSITIVE_PATHS.includes(path)) continue
    await storage.write(path, strFromU8(bytes))
    files++
  }
  return { files }
}
