import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate"
import type { VaultStorage } from "./storage"

export async function exportVaultZip(storage: VaultStorage): Promise<Uint8Array> {
  const entries: Record<string, Uint8Array> = {}
  for (const path of await storage.list()) {
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
    await storage.write(path, strFromU8(bytes))
    files++
  }
  return { files }
}
