import { zipSync, unzipSync } from "fflate"
import type { VaultStorage } from "./storage"
import { isSafeVaultRelativePath } from "./safe-path"

// Paths that must never leave the device via vault export, and must never be
// ingested from an imported vault. Today this is just .scispark/settings.json,
// which stores BYOK provider API keys in plaintext (src/lib/llm/settings.ts) —
// exporting it would hand out live billing credentials to whoever the vault is
// shared with, and importing it would clobber the importer's own keys with the
// sharer's. Keep this list here so future secret-bearing files get added too.
const SENSITIVE_PATHS = new Set([".scispark/settings.json"])

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATHS.has(path.toLowerCase())
}

export async function exportVaultZip(storage: VaultStorage): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {}
  for (const path of await storage.list()) {
    if (isSensitivePath(path)) continue
    // Read every path as raw bytes — text files round-trip identically as
    // their UTF-8 encoding, and this is the only way to move binary paths
    // (e.g. images, PDFs) through the zip losslessly.
    const content = await storage.readBinary(path)
    if (content !== null) entries[path] = content
  }
  return zipSync(entries)
}

export async function importVaultZip(
  storage: VaultStorage,
  data: Uint8Array,
): Promise<{ files: number }> {
  const entries = unzipSync(data)
  const filesToWrite = Object.entries(entries).filter(([path]) => !path.endsWith("/"))

  // Validate the whole archive before the first write. A crafted ZIP must not
  // partially restore and then fail on a later traversal/absolute path.
  for (const [path] of filesToWrite) {
    if (!isSafeVaultRelativePath(path)) {
      throw new Error(`unsafe vault archive path: ${path}`)
    }
  }

  let files = 0
  for (const [path, bytes] of filesToWrite) {
    if (isSensitivePath(path)) continue
    await storage.writeBinary(path, bytes)
    files++
  }
  return { files }
}
