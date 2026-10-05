import { resolve, sep } from "node:path"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import type { VaultStorage } from "../vault/storage"

const SENTINEL_ROOT = resolve("/__vault_root__")
const PRIVATE_ROOTS = [".scispark/tools", ".scispark/tool-runs"].map((path) => resolve(SENTINEL_ROOT, path).toLowerCase())
/** Match NodeFsVaultStorage resolution, including normalized spellings on case-insensitive hosts. */
export function isPrivateWorkflowPath(path: string): boolean {
  const absolute = resolve(SENTINEL_ROOT, path).toLowerCase()
  return PRIVATE_ROOTS.some((root) => absolute === root || absolute.startsWith(root + sep))
}

/** Production server storage is filesystem-backed; injected memory stores
 * have no symlinks. Reject all filesystem aliases at the raw generic boundary,
 * including nonexistent leaves under an existing symlinked parent. */
export async function isGenericVaultSymlinkPath(storage: VaultStorage, path: string): Promise<boolean> {
  return storage instanceof NodeFsVaultStorage && await storage.hasSymlinkTraversal(path)
}
