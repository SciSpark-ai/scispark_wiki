import type { VaultStorage } from "../vault/storage"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { resolveVaultRoot } from "../vault/vault-path"
import { openVault } from "../vault/scaffold"

let vaultPromise: Promise<VaultStorage> | null = null
let testOverride: VaultStorage | null = null

/** Test hook: force the server vault (pass null to clear). */
export function setServerVaultForTests(storage: VaultStorage | null): void {
  testOverride = storage
  vaultPromise = null
}

/** The server-side vault singleton: NodeFs at the resolved root, scaffolded once. */
export function getServerVault(): Promise<VaultStorage> {
  if (testOverride) return Promise.resolve(testOverride)
  if (!vaultPromise) {
    vaultPromise = (async () => {
      const storage = new NodeFsVaultStorage(resolveVaultRoot())
      await openVault(storage)
      return storage
    })().catch((err) => {
      vaultPromise = null
      throw err
    })
  }
  return vaultPromise
}
